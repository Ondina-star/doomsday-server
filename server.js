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
// 🛡️ RUTA HEALTH CHECK INDISPENSABLE PARA RENDER
// ==========================================
app.get('/', (req, res) => {
    res.status(200).send("OK");
});
// ==========================================
// 🚀 ARRANQUE INMEDIATO DE RED (PASO A LIVE)
// ==========================================
const PORT = process.env.PORT || 3000;
server.listen(PORT, '0.0.0.0', () => {
    console.log(`☢️ Antenas encendidas. Doomsday Servidor escuchando en puerto: ${PORT}`);
    initDatabase();
});

// ==========================================
// 📦 INICIALIZACIÓN ASÍNCRONA DE LA BASE DE DATOS
// ==========================================
async function initDatabase() {
    try {
        await pool.query(`
            CREATE TABLE IF NOT EXISTS events (
                id SERIAL PRIMARY KEY,
                event_date VARCHAR(50) NOT NULL UNIQUE
            );
            CREATE TABLE IF NOT EXISTS commanders (
                id VARCHAR(50) PRIMARY KEY,
                name VARCHAR(100) NOT NULL,
                event_date VARCHAR(50) NOT NULL,
                status VARCHAR(50) DEFAULT 'Pending',
                chat VARCHAR(50) DEFAULT 'Out',
                day1 INT DEFAULT 0,
                day2 INT DEFAULT 0,
                day3 INT DEFAULT 0
            );
            CREATE TABLE IF NOT EXISTS blacklist (
                id VARCHAR(50) PRIMARY KEY,
                name VARCHAR(100),
                reason TEXT
            );
        `);
        console.log("🔥 Base de datos validada y lista en segundo plano.");
    } catch (err) {
        console.error("❌ Error en segundo plano de base de datos:", err.message);
    }
}


// Ejecución controlada del búnker
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
            const id = String(data.id || data.commander_id || data.identity_no).trim();
            const { name } = data;
            const event_date = data.event_date || '2026-11-06';
            
            if (!id || !name) return console.warn("⚠️ Campos críticos ausentes en add_new_commander_cloud.");

            // CORREGIDO EN KHAN: Forzamos DO UPDATE en todos los campos para que PostgreSQL jamás rebote la query por conflicto de ID duplicado o antiguo
            const queryText = `
                INSERT INTO commanders (id, name, event_date, status, chat, day1, day2, day3) 
                VALUES ($1, $2, $3, 'Pending', 'Out', 0, 0, 0) 
                ON CONFLICT (id) DO UPDATE SET 
                    name = EXCLUDED.name,
                    event_date = EXCLUDED.event_date,
                    status = 'Pending',
                    chat = 'Out',
                    day1 = 0,
                    day2 = 0,
                    day3 = 0
            `;

            await pool.query(queryText, [id, name, event_date]);
            io.emit('commander_synchronized');
        } catch (e) { 
            console.error("❌ Error crítico en add_new_commander_cloud:", e); 
        }
    });
    socket.on('update_commander_data', async (data) => {
        try {
            // CORREGIDO EN CONTROL: Forzamos la limpieza absoluta de espacios invisibles en el ID
            const commander_id = String(data.commander_id || data.id || data.identity_no).trim();
            const { field, value } = data;
            
            if (!commander_id || !field) return console.warn("⚠️ Operación abortada: Parámetros insuficientes.");

            let databaseField = field;
            if (field === 'day1_packs') databaseField = 'day1';
            if (field === 'day2_packs') databaseField = 'day2';
            if (field === 'day3_packs') databaseField = 'day3';

            // Saneamos el valor forzando minúsculas y limpiando espacios si es un texto (como los estados 'confirmed')
            const safeValue = (typeof value === 'string') ? value.toLowerCase().trim() : value;

            // CORREGIDO EN CONTINGENCIA: Usamos TRIM(id) para que PostgreSQL ignore espacios invisibles y suelde el cambio en el disco duro real
            await pool.query(`UPDATE commanders SET ${databaseField} = $1 WHERE TRIM(id) = $2`, [safeValue, commander_id]);
            
            io.emit('commander_synchronized');
        } catch (e) {
            console.error("❌ Error crítico en update_commander_data:", e);
        }
    });
});



