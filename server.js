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

// Rutas de inicio rápido para sincronizar los navegadores
app.get('/api/commanders', async (req, res) => {
    try {
        const result = await pool.query('SELECT * FROM commanders ORDER BY identity_no ASC');
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
            console.error(e);
        }
    });

    socket.on('add_new_commander_cloud', async (data) => {
        try {
            const { id, name } = data;
            const eventRes = await pool.query('SELECT id FROM events LIMIT 1');
            if(eventRes.rows.length > 0) {
                await pool.query('INSERT INTO commanders (event_id, identity_no, commander_name) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING', [eventRes.rows[0].id, id, name]);
                io.emit('commander_synchronized');
            }
        } catch (e) {
            console.error(e);
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
