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
        // 1. Crear tablas si no existen
        await pool.query(`
            CREATE TABLE IF NOT EXISTS events (
                id SERIAL PRIMARY KEY,
                event_name VARCHAR(100) DEFAULT 'CLOCKWORK_SHUTDOWN',
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
        await pool.query(`ALTER TABLE commanders ADD COLUMN IF NOT EXISTS chat VARCHAR(50) DEFAULT 'Out';`);
        await pool.query(`UPDATE commanders SET status = 'Pending' WHERE status IS NULL;`);
        await pool.query(`UPDATE commanders SET chat = 'Out' WHERE chat IS NULL;`);
        await pool.query(`UPDATE commanders SET day1_packs = 0 WHERE day1_packs IS NULL;`);
        await pool.query(`UPDATE commanders SET day2_packs = 0 WHERE day2_packs IS NULL;`);
        await pool.query(`UPDATE commanders SET day3_packs = 0 WHERE day3_packs IS NULL;`);
        console.log("✅ Tablas de contingencia validadas en la nube.");

        // 2. CORREGIDO: Aseguramos la existencia del evento oficial del 06 de Noviembre para evitar que el INNER JOIN devuelva listas vacías
        const eventCheckNov = await pool.query("SELECT id FROM events WHERE event_date = '2026-11-06' LIMIT 1");
        if (eventCheckNov.rows.length === 0) {
            await pool.query("INSERT INTO events (event_name, event_date) VALUES ('CLOCKWORK_SHUTDOWN', '2026-11-06')");
            console.log("📅 Evento base del 06 de Noviembre registrado con éxito.");
        }

        const eventCheckDec = await pool.query("SELECT id FROM events WHERE event_date = '2026-12-02' LIMIT 1");
        if (eventCheckDec.rows.length === 0) {
            await pool.query("INSERT INTO events (event_name, event_date) VALUES ('CLOCKWORK_SHUTDOWN', '2026-12-02')");
            console.log("📅 Evento base del 02 de Diciembre registrado.");
        }
    } catch (err) {
        console.error("❌ Error inicializando la Base de Datos:", err.message);
    }
}
initDatabase();

// Rutas de inicio rápido para sincronizar los navegadores
app.get('/api/commanders', async (req, res) => {
    try {
        // CORREGIDO CON TIMEZONE UTC: Forzamos la extracción pura en formato YYYY-MM-DD bloqueando desajustes de horas en el móvil
        const queryText = `
            SELECT c.identity_no AS id, c.commander_name AS name, 
                   c.day1_packs AS day1, c.day2_packs AS day2, c.day3_packs AS day3, 
                   c.status, c.chat, TO_CHAR(e.event_date AT TIME ZONE 'UTC', 'YYYY-MM-DD') AS event_date
            FROM commanders c
            INNER JOIN events e ON c.event_id = e.id
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
            const { commander_id, field, value } = data;
            
            if (field === 'status' && value === 'Confirmed') {
                const countRes = await pool.query("SELECT COUNT(*) FROM commanders WHERE status = 'Confirmed'");
                if (parseInt(countRes.rows[0].count) >= 180) {
                    socket.emit('error_notification', { message: '⚠️ CAPACIDAD MÁXIMA BLOQUEADA: El chat ya alcanzó el límite estricto de 180 comandantes.' });
                    return;
                }
            }

            let databaseField = field;
            if(field === 'day1') databaseField = 'day1_packs';
            if(field === 'day2') databaseField = 'day2_packs';
            if(field === 'day3') databaseField = 'day3_packs';

            await pool.query(`UPDATE commanders SET ${databaseField} = $1, updated_at = NOW() WHERE identity_no = $2`, [value, commander_id]);
            io.emit('commander_synchronized');
        } catch (e) {
            console.error("❌ Error en update_commander_data:", e);
        }
    });

    socket.on('add_new_commander_cloud', async (data) => {
        try {
            const { id, name } = data;
            
            let eventRes = await pool.query("SELECT id FROM events WHERE event_date = '2026-11-06' LIMIT 1");
            if (eventRes.rows.length === 0) {
                await pool.query("INSERT INTO events (event_name, event_date) VALUES ('CLOCKWORK_SHUTDOWN', '2026-11-06')");
                eventRes = await pool.query("SELECT id FROM events WHERE event_date = '2026-11-06' LIMIT 1");
            }
            
            const eventId = eventRes.rows[0].id;
            
            await pool.query(
                'INSERT INTO commanders (event_id, identity_no, commander_name, status, chat, day1_packs, day2_packs, day3_packs) VALUES ($1, $2, $3, \'Pending\', \'Out\', 0, 0, 0) ON CONFLICT (identity_no) DO UPDATE SET commander_name = $3', 
                [eventId, id, name]
            );
            
            io.emit('commander_synchronized');
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
