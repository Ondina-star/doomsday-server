const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const { Pool } = require('pg');
const cors = require('cors');
require('dotenv').config();

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: "*" } });

app.use(cors());
app.use(express.json());

const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false }
});

// ==========================================
// ☢️ AUTO-CREACIÓN DE TABLAS E INICIALIZACIÓN
// ==========================================
async function initDatabase() {
    try {
        // 1. Crear tablas base si no existen
        await pool.query(`
            CREATE TABLE IF NOT EXISTS events (
                id SERIAL PRIMARY KEY,
                event_date DATE NOT NULL,
                created_at TIMESTAMP DEFAULT NOW()
            );
            CREATE TABLE IF NOT EXISTS commanders (
                identity_no VARCHAR(50) PRIMARY KEY,
                event_id INTEGER,
                commander_name VARCHAR(100) NOT NULL,
                status VARCHAR(50) DEFAULT 'Pending',
                day1_packs INTEGER DEFAULT 0,
                day2_packs INTEGER DEFAULT 0,
                day3_packs INTEGER DEFAULT 0,
                updated_at TIMESTAMP DEFAULT NOW()
            );
            CREATE TABLE IF NOT EXISTS blacklist (
                id SERIAL PRIMARY KEY,
                identity_no VARCHAR(50) UNIQUE,
                commander_name VARCHAR(100),
                reason TEXT,
                created_at TIMESTAMP DEFAULT NOW()
            );
        `);
        
        // 🛠️ AUTOMODIFICACIÓN TÁCTICA: Forzamos la creación de columnas si tu PostgreSQL viejo no las tiene
        await pool.query(`ALTER TABLE events ADD COLUMN IF NOT EXISTS event_name VARCHAR(100) DEFAULT 'CLOCKWORK_SHUTDOWN';`);
        await pool.query(`ALTER TABLE commanders ADD COLUMN IF NOT EXISTS chat VARCHAR(50) DEFAULT 'Out';`);
        
        await pool.query(`UPDATE commanders SET status = 'Pending' WHERE status IS NULL;`);
        await pool.query(`UPDATE commanders SET chat = 'Out' WHERE chat IS NULL;`);
        await pool.query(`UPDATE commanders SET day1_packs = 0 WHERE day1_packs IS NULL;`);
        await pool.query(`UPDATE commanders SET day2_packs = 0 WHERE day2_packs IS NULL;`);
        await pool.query(`UPDATE commanders SET day3_packs = 0 WHERE day3_packs IS NULL;`);
        console.log("✅ Tablas de contingencia y columnas reparadas en la nube.");

        // 2. Registramos el evento base de Noviembre para que coincida con tu panel web
        const eventCheckNov = await pool.query("SELECT id FROM events WHERE event_date = '2026-11-06' LIMIT 1");
        if (eventCheckNov.rows.length === 0) {
            await pool.query("INSERT INTO events (event_name, event_date) VALUES ('CLOCKWORK_SHUTDOWN', '2026-11-06')");
            console.log("📅 Evento base del 06 de Noviembre registrado con éxito.");
        }
    } catch (err) {
        console.error("❌ Error inicializando la Base de Datos:", err.message);
    }
}
initDatabase();

// Rutas de inicio rápido para sincronizar los navegadores
app.get('/api/commanders', async (req, res) => {
    try {
        const queryText = `
            SELECT c.identity_no AS id, c.commander_name AS name, 
                   c.day1_packs AS day1, c.day2_packs AS day2, c.day3_packs AS day3, 
                   c.status, c.chat, TO_CHAR(e.event_date AT TIME ZONE 'UTC', 'YYYY-MM-DD') AS event_date
            FROM commanders c
            LEFT JOIN events e ON c.event_id = e.id
            ORDER BY c.identity_no ASC
        `;
        const result = await pool.query(queryText);
        res.json(result.rows);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.get('/api/blacklist', async (req, res) => {
    try {
        const result = await pool.query('SELECT * FROM blacklist ORDER BY id DESC');
        res.json(result.rows);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Canales de comunicación Multioperador en tiempo real
io.on('connection', (socket) => {
    console.log('🔗 Oficial de comunicaciones conectado:', socket.id);
    socket.on('update_commander_data', async (data) => {
        try {
            // CORREGIDO: Captura ultra segura del ID usando respaldo dinámico de propiedades
            const commander_id = data.commander_id || data.id || data.identity_no;
            const { field, value } = data;
            
            if (!commander_id) return console.warn("⚠️ Operación abortada: ID del comandante ausente.");

            let databaseField = field;
            if(field === 'day1') databaseField = 'day1_packs';
            if(field === 'day2') databaseField = 'day2_packs';
            if(field === 'day3') databaseField = 'day3_packs';

            // CORREGIDO: Ejecutamos la query forzando el ID verificado y sano en la columna identity_no
            await pool.query(`UPDATE commanders SET ${databaseField} = $1, updated_at = NOW() WHERE identity_no = $2`, [value, commander_id]);
            
            io.emit('commander_synchronized');
        } catch (e) {
            console.error("❌ Error en update_commander_data:", e);
        }
    });

     socket.on('add_new_commander_cloud', async (data) => {
        try {
            const id = data.id || data.commander_id || data.identity_no;
            const { name } = data;
            
            if (!id || !name) return console.warn("⚠️ Registro abortado: Faltan campos críticos.");

            // 1. Buscamos el evento base del 06 de Noviembre en PostgreSQL de forma directa
            let eventRes = await pool.query("SELECT id FROM events WHERE event_date = '2026-11-06' LIMIT 1");
            
            // 2. Si por algún motivo se borró de la base de datos cloud, usamos el primero que exista como respaldo
            if (eventRes.rows.length === 0) {
                eventRes = await pool.query("SELECT id FROM events LIMIT 1");
            }
            
            if (eventRes.rows.length > 0) {
                const eventId = eventRes.rows[0].id;
                
                // 3. Inserción blindada en PostgreSQL en la nube de Render
                await pool.query(
                    'INSERT INTO commanders (event_id, identity_no, commander_name, status, chat, day1_packs, day2_packs, day3_packs) VALUES ($1, $2, $3, \'Pending\', \'Out\', 0, 0, 0) ON CONFLICT (identity_no) DO UPDATE SET commander_name = $3', 
                    [eventId, id, name]
                );
                
                io.emit('commander_synchronized');
            } else {
                console.warn("⚠️ Operación abortada: No hay ningún evento registrado en PostgreSQL.");
            }
        } catch (e) {
            console.error("❌ Error crítico insertando comandante en la nube:", e);
        }
    });

    socket.on('blacklist_enforcement_cloud', async (data) => {
        try {
            const { id, name, reason } = data;
            await pool.query('INSERT INTO blacklist (identity_no, commander_name, reason) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING', [id, name, reason]);
            await pool.query("DELETE FROM commanders WHERE identity_no = $1", [id]);
            io.emit('commander_synchronized');
        } catch (e) {
            console.error(e);
        }
    });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log('☢️ Servidor Doomsday Online en Puerto ' + PORT);
});
