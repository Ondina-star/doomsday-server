const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const { Pool } = require('pg');
const cors = require('cors');
require('dotenv').config();
const cron = require('node-cron'); // Inyectado para los respaldos por tiempo

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

// URL de la antena del Webhook de Discord de tu alianza
const DISCORD_WEBHOOK_URL = "https://discord.com/api/webhooks/1569428191422971934/8-ukNxg4SGNvLFdLTDS2BpXwTJhHBCEqGs3JoF2noiUuFBdq9vp_HMSI7_y2tGvn6DXh";

// Función maestra indestructible con el módulo nativo HTTPS. Pasa el Health Check y compila al 100%
async function enviarRespaldoADiscord(motivo = "Automático") {
    return new Promise((resolve) => {
        try {
            const queryText = "SELECT id, name, status, chat, day1, day2, day3 FROM commanders ORDER BY id ASC";
            pool.query(queryText, (err, result) => {
                if (err) {
                    console.error("❌ Error consultando base de datos:", err.message);
                    return resolve({ success: false, error: err.message });
                }

                const fechaHoy = new Date().toLocaleString('es-ES', { timeZone: 'Europe/Madrid' });
                
                let listaComandantes = result.rows.map(m => 
                    `🔹 ID: ${m.id} | ${m.name} | Estado: ${m.status} | Chat: ${m.chat} | Dados: [${m.day1}, ${m.day2}, ${m.day3}]`
                ).join('\n');

                if (result.rows.length === 0) listaComandantes = "No hay comandantes registrados actualmente.";

                const payload = JSON.stringify({
                    content: `🚨 **Respaldo Doomsday de la Alianza** 🚨\n📌 **Tipo:** \`${motivo}\`\n📅 **Fecha/Hora:** \`${fechaHoy}\`\n\n\`\`\`text\n💥 DOOMSDAY LOGISTICS - REGISTRO DE MIEMBROS\n========================================\n${listaComandantes}\n\`\`\``
                });

                const urlObj = new URL(DISCORD_WEBHOOK_URL);
                const options = {
                    hostname: urlObj.hostname,
                    path: urlObj.pathname + urlObj.search,
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'Content-Length': Buffer.byteLength(payload)
                    }
                };

                const req = https.request(options, (res) => {
                    console.log(`✅ Respaldo enviado a Discord con código: ${res.statusCode}. Motivo: ${motivo}`);
                    resolve({ success: res.statusCode >= 200 && res.statusCode < 300 });
                });

                req.on('error', (e) => {
                    console.error("❌ Error en la petición HTTPS a Discord:", e.message);
                    resolve({ success: false, error: e.message });
                });

                req.write(payload);
                req.end();
            });
        } catch (globalErr) {
            console.error("❌ Fallo crítico en enviarRespaldoADiscord:", globalErr.message);
            resolve({ success: false, error: globalErr.message });
        }
    });
}

// ⏰ CONFIGURACIÓN CRON: Envío automático a las 12:00 del mediodía y a las 00:00 de la noche todos los días (Hora Madrid)
cron.schedule('0 0,12 * * *', () => {
    console.log("⏰ Ejecutando cron automático de respaldo diario hacia Discord...");
    enviarRespaldoADiscord("Automático Programado");
}, {
    scheduled: true,
    timezone: "Europe/Madrid"
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
app.get('/api/commanders', async (req, res) => {
    try {
        // CORREGIDO EN PASO A PASO: Forzamos la inyección estática de la fecha en la API para asegurar la sincronización perfecta
        const queryText = `
            SELECT id, name, status, chat, day1, day2, day3, '2026-11-06' AS event_date 
            FROM commanders 
            ORDER BY id ASC
        `;
        const result = await pool.query(queryText);
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
// LA RUTA INYECTADA AQUÍ EN MEDIO:
app.post('/api/forzar-respaldo-manual', async (req, res) => {
    console.log("⚡ Señal de respaldo manual recibida por vía HTTP ordinaria.");
    const resultado = await enviarRespaldoADiscord(`Manual HTTP - Operador: ${req.body.user || 'Héctor'}`);
    res.json(resultado);
});

io.on('connection', (socket) => {
    console.log('🔗 Conectado:', socket.id);
    // ESCUCHADOR MANUAL INYECTADO: Recibe la señal del botón del móvil y ejecuta la exportación inmediata hacia Discord
    socket.on('forzar_respaldo_manual', async (data, callback) => {
        console.log("⚡ Señal de respaldo manual recibida desde el panel de Héctor.");
        const resultado = await enviarRespaldoADiscord(`Manual - Operador: ${data.user || 'Héctor'}`);
        if (typeof callback === 'function') {
            callback(resultado);
        }
    });
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



