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
                chat VARCHAR(50) DEFAULT 'Out',
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
        console.log("✅ Estructura PostgreSQL unificada y validada en Render.");

        // Forzamos el registro del evento base del 06 de Noviembre
        const eventCheck = await pool.query("SELECT id FROM events WHERE event_date = '2026-11-06' LIMIT 1");
        if (eventCheck.rows.length === 0) {
            await pool.query("INSERT INTO events (event_name, event_date) VALUES ('CLOCKWORK_SHUTDOWN', '2026-11-06')");
            console.log("📅 Evento base del 06 de Noviembre registrado.");
        }
    } catch (err) {
        console.error("❌ Error inicializando la Base de Datos:", err.message);
    }
}
initDatabase();

// UNIFICADO: Ruta de descarga limpia con los nombres nativos de la base de datos
app.get('/api/commanders', async (req, res) => {
    try {
        const result = await pool.query(`
            SELECT c.identity_no AS id, c.commander_name AS name, 
                   c.day1_packs AS day1, c.day2_packs AS day2, c.day3_packs AS day3, 
                   c.status, c.chat, TO_CHAR(e.event_date AT TIME ZONE 'UTC', 'YYYY-MM-DD') AS event_date
            FROM commanders c
            LEFT JOIN events e ON c.event_id = e.id
            ORDER BY c.identity_no ASC
        `);
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

io.on('connection', (socket) => {
    console.log('🔗 Conectado:', socket.id);

    socket.on('update_commander_data', async (data) => {
        try {
            const { commander_id, field, value } = data;
            if (!commander_id || !field) return;

            let databaseField = field;
            if (field === 'day1') databaseField = 'day1_packs';
            if (field === 'day2') databaseField = 'day2_packs';
            if (field === 'day3') databaseField = 'day3_packs';

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
            if (!id || !name) return;

            // 1. Buscamos el evento de forma limpia y directa en la base de datos
            let eventRes = await pool.query("SELECT id FROM events WHERE event_date = '2026-11-06' LIMIT 1");
            
            // CORREGIDO CON ÍNDICE MANUAL: Acceso estricto a la primera posición del array para que nunca viaje vacío
            let eventId = (eventRes.rows && eventRes.rows.length > 0) ? eventRes.rows[0].id : 1;

            // 2. Inserción directa y blindada en PostgreSQL de Render
            await pool.query(
                `INSERT INTO commanders (event_id, identity_no, commander_name, status, chat, day1_packs, day2_packs, day3_packs) 
                 VALUES ($1, $2, $3, 'Pending', 'Out', 0, 0, 0) 
                 ON CONFLICT (identity_no) DO UPDATE SET commander_name = $3`, 
                [eventId, id, name]
            );
            io.emit('commander_synchronized');
        } catch (e) {
            console.error("❌ Error en add_new_commander_cloud:", e);
        }
    });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => { console.log('☢️ Servidor Doomsday Online: ' + PORT); });
