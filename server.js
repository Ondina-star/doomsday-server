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

async function initDatabase() {
    try {
        // RESET TOTAL: Destruye las tablas viejas desalineadas y las crea de cero con el contrato de datos puro
        await pool.query('DROP TABLE IF EXISTS commanders, blacklist, events CASCADE;');
        await pool.query(`
            CREATE TABLE events (
                id SERIAL PRIMARY KEY,
                event_date VARCHAR(50) NOT NULL UNIQUE
            );
            CREATE TABLE commanders (
                id VARCHAR(50) PRIMARY KEY,
                name VARCHAR(100) NOT NULL,
                event_date VARCHAR(50) NOT NULL,
                status VARCHAR(50) DEFAULT 'Pending',
                chat VARCHAR(50) DEFAULT 'Out',
                day1 INT DEFAULT 0,
                day2 INT DEFAULT 0,
                day3 INT DEFAULT 0
            );
            CREATE TABLE blacklist (
                id VARCHAR(50) PRIMARY KEY,
                name VARCHAR(100),
                reason TEXT
            );
        `);
        await pool.query("INSERT INTO events (event_date) VALUES ('2026-11-06') ON CONFLICT DO NOTHING;");
        console.log("🔥 Base de datos reseteada y unificada al 100% en Render.");
    } catch (err) {
        console.error("❌ Error inicializando:", err.message);
    }
}
initDatabase();

app.get('/api/commanders', async (req, res) => {
    try {
        const result = await pool.query("SELECT * FROM commanders ORDER BY id ASC");
        res.json(result.rows);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.get('/api/blacklist', async (req, res) => {
    try {
        const result = await pool.query("SELECT * FROM blacklist ORDER BY id DESC");
        res.json(result.rows);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

io.on('connection', (socket) => {
    console.log('🔗 Conectado:', socket.id);

    socket.on('add_new_commander_cloud', async (data) => {
        try {
            const { id, name, event_date } = data;
            if (!id || !name || !event_date) return;
            await pool.query(
                `INSERT INTO commanders (id, name, event_date, status, chat, day1, day2, day3) 
                 VALUES ($1, $2, $3, 'Pending', 'Out', 0, 0, 0) 
                 ON CONFLICT (id) DO UPDATE SET name = $2`, 
                [id, name, event_date]
            );
            io.emit('commander_synchronized');
        } catch (e) { console.error(e); }
    });

            socket.on('update_commander_data', async (data) => {
        try {
            const commander_id = data.commander_id || data.id || data.identity_no;
            const { field, value } = data;
            
            if (!commander_id || !field) return console.warn("⚠️ Operación abortada: Faltan campos críticos.");

            let databaseField = field;
            if (field === 'day1_packs') databaseField = 'day1';
            if (field === 'day2_packs') databaseField = 'day2';
            if (field === 'day3_packs') databaseField = 'day3';

            // CORREGIDO EN KHAN: Saneamos el valor forzando la conversión a minúsculas si es una cadena de texto (como los estados 'confirmed', 'canceled', etc.) para que el filtro gráfico no se rompa al recargar
            const safeValue = (typeof value === 'string') ? value.toLowerCase().trim() : value;

            // Actualización indestructible forzando los campos normalizados en PostgreSQL
            await pool.query(`UPDATE commanders SET ${databaseField} = $1 WHERE id = $2`, [safeValue, commander_id]);
            
            io.emit('commander_synchronized');
        } catch (e) {
            console.error("❌ Error en update_commander_data:", e);
        }
    });

});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => { console.log('☢️ Servidor Online: ' + PORT); });
