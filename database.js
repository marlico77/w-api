/**
 * SAPI API - Conexão e Queries do Banco de Dados (PostgreSQL/Supabase)
 * Desenvolvido por: Marlon Souza
 * Licença: Atribuição Obrigatória (Manter Créditos)
 * 
 * Assinatura: Marlon Souza © 2026
 */

const { Pool } = require('pg');
require('dotenv').config();
const crypto = require('crypto');

const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: {
        rejectUnauthorized: false
    }
});

function hashPassword(password) {
    const salt = 'zap-api-salt-2026';
    return crypto.pbkdf2Sync(password, salt, 1000, 64, 'sha512').toString('hex');
}

const initDb = async () => {
    try {
        await pool.query(`CREATE TABLE IF NOT EXISTS instances (
            id TEXT PRIMARY KEY,
            token TEXT,
            "createdAt" TEXT,
            wh_message_in TEXT,
            wh_message_out TEXT,
            wh_connect TEXT,
            wh_disconnect TEXT,
            wh_status TEXT,
            wh_presence TEXT,
            notify_own_msg INTEGER DEFAULT 0,
            opt_reject_call INTEGER DEFAULT 0,
            opt_read_msg INTEGER DEFAULT 0,
            opt_read_status INTEGER DEFAULT 0,
            opt_disable_queue INTEGER DEFAULT 0
        )`);

        await pool.query(`CREATE TABLE IF NOT EXISTS contacts (
            id SERIAL PRIMARY KEY,
            instance_id TEXT,
            number TEXT,
            name TEXT,
            "isGroup" INTEGER DEFAULT 0,
            UNIQUE(instance_id, number)
        )`);

        await pool.query(`ALTER TABLE contacts ADD COLUMN IF NOT EXISTS opt_in INTEGER DEFAULT 1`);
        await pool.query(`ALTER TABLE contacts ADD COLUMN IF NOT EXISTS opt_out INTEGER DEFAULT 0`);

        await pool.query(`CREATE TABLE IF NOT EXISTS campaigns (
            id SERIAL PRIMARY KEY,
            instance_id TEXT,
            name TEXT,
            message TEXT,
            scheduled_at TEXT,
            status TEXT DEFAULT 'pending',
            is_recurring INTEGER DEFAULT 0,
            recurrence_days TEXT,
            recurrence_times TEXT
        )`);

        await pool.query(`ALTER TABLE campaigns ADD COLUMN IF NOT EXISTS is_recurring INTEGER DEFAULT 0`);
        await pool.query(`ALTER TABLE campaigns ADD COLUMN IF NOT EXISTS recurrence_days TEXT`);
        await pool.query(`ALTER TABLE campaigns ADD COLUMN IF NOT EXISTS recurrence_times TEXT`);

        await pool.query(`CREATE TABLE IF NOT EXISTS campaign_queue (
            id SERIAL PRIMARY KEY,
            campaign_id INTEGER,
            contact_number TEXT,
            status TEXT DEFAULT 'pending'
        )`);

        await pool.query(`CREATE TABLE IF NOT EXISTS projects (
            id SERIAL PRIMARY KEY,
            name TEXT,
            website TEXT,
            api_key TEXT UNIQUE,
            instance_id TEXT,
            created_at TEXT
        )`);

        await pool.query(`ALTER TABLE projects ADD COLUMN IF NOT EXISTS instance_id TEXT`);

        await pool.query(`CREATE TABLE IF NOT EXISTS api_logs (
            id SERIAL PRIMARY KEY,
            project_id INTEGER REFERENCES projects(id) ON DELETE CASCADE,
            endpoint TEXT,
            method TEXT,
            status_code INTEGER,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )`);

        await pool.query(`CREATE TABLE IF NOT EXISTS users (
            username TEXT PRIMARY KEY,
            password_hash TEXT,
            created_at TEXT
        )`);

        // Migrações de campos de usuário
        await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS full_name TEXT`);
        await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS cpf TEXT`);
        await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS address TEXT`);
        await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS email TEXT UNIQUE`);
        await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS role TEXT DEFAULT 'USUARIO'`);
        await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS google_id TEXT UNIQUE`);

        // Migrações de relacionamentos / posse de recursos
        await pool.query(`ALTER TABLE instances ADD COLUMN IF NOT EXISTS created_by TEXT`);
        await pool.query(`ALTER TABLE projects ADD COLUMN IF NOT EXISTS created_by TEXT`);

        const userCheck = await pool.query("SELECT COUNT(*) FROM users");
        if (parseInt(userCheck.rows[0].count, 10) === 0) {
            const adminPassHash = hashPassword('admin123');
            const nowStr = new Date().toLocaleString('pt-BR');
            await pool.query("INSERT INTO users (username, password_hash, created_at, role) VALUES ($1, $2, $3, 'ADMINISTRADOR')", ['ADMINISTRADOR', adminPassHash, nowStr]);
            console.log('✅ Seeded default user ADMINISTRADOR with password admin123');
        } else {
            // Garante que o administrador padrão possui papel de ADMINISTRADOR
            await pool.query(`UPDATE users SET role = 'ADMINISTRADOR' WHERE username = 'ADMINISTRADOR'`);
        }

        // Atualização preventiva de recursos legados sem proprietário
        await pool.query(`UPDATE instances SET created_by = 'ADMINISTRADOR' WHERE created_by IS NULL`);
        await pool.query(`UPDATE projects SET created_by = 'ADMINISTRADOR' WHERE created_by IS NULL`);

        console.log('✅ PostgreSQL tables checked/created successfully');
    } catch (err) {
        console.error('❌ Error initializing database:', err);
    }
};

const initPromise = initDb();

const getInstances = async () => {
    const res = await pool.query("SELECT * FROM instances");
    return res.rows;
};

const saveInstance = async (data) => {
    const query = `
        INSERT INTO instances (
            id, token, "createdAt", 
            wh_message_in, wh_message_out, wh_connect, wh_disconnect, wh_status, wh_presence,
            notify_own_msg, opt_reject_call, opt_read_msg, opt_read_status, opt_disable_queue,
            created_by
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)
        ON CONFLICT (id) DO UPDATE SET
            token = EXCLUDED.token,
            "createdAt" = EXCLUDED."createdAt",
            wh_message_in = EXCLUDED.wh_message_in,
            wh_message_out = EXCLUDED.wh_message_out,
            wh_connect = EXCLUDED.wh_connect,
            wh_disconnect = EXCLUDED.wh_disconnect,
            wh_status = EXCLUDED.wh_status,
            wh_presence = EXCLUDED.wh_presence,
            notify_own_msg = EXCLUDED.notify_own_msg,
            opt_reject_call = EXCLUDED.opt_reject_call,
            opt_read_msg = EXCLUDED.opt_read_msg,
            opt_read_status = EXCLUDED.opt_read_status,
            opt_disable_queue = EXCLUDED.opt_disable_queue,
            created_by = EXCLUDED.created_by
    `;
    await pool.query(query, [
        data.id, data.token, data.createdAt,
        data.wh_message_in || '', data.wh_message_out || '', data.wh_connect || '', 
        data.wh_disconnect || '', data.wh_status || '', data.wh_presence || '',
        data.notify_own_msg ? 1 : 0, data.opt_reject_call ? 1 : 0, 
        data.opt_read_msg ? 1 : 0, data.opt_read_status ? 1 : 0, data.opt_disable_queue ? 1 : 0,
        data.created_by || 'ADMINISTRADOR'
    ]);
    return true;
};

const deleteInstanceDb = async (id) => {
    await pool.query("DELETE FROM instances WHERE id = $1", [id]);
    return true;
};

// ==========================
// CONTATOS
// ==========================
const saveContacts = async (instanceId, contactsList) => {
    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        const query = `
            INSERT INTO contacts (instance_id, number, name, "isGroup")
            VALUES ($1, $2, $3, $4)
            ON CONFLICT (instance_id, number) DO UPDATE SET
                name = EXCLUDED.name,
                "isGroup" = EXCLUDED."isGroup"
        `;
        for (let c of contactsList) {
            await client.query(query, [instanceId, c.number, c.name, c.isGroup ? 1 : 0]);
        }
        await client.query('COMMIT');
        return true;
    } catch (e) {
        await client.query('ROLLBACK');
        throw e;
    } finally {
        client.release();
    }
};

const getContacts = async (instanceId) => {
    const res = await pool.query("SELECT * FROM contacts WHERE instance_id = $1", [instanceId]);
    return res.rows;
};

// ==========================
// CAMPANHAS
// ==========================
const createCampaign = async (instanceId, name, message, scheduledAt, contactsArray, recurrence = null) => {
    let is_recurring = 0;
    let recurrence_days = null;
    let recurrence_times = null;
    if (recurrence && recurrence.is_recurring) {
        is_recurring = 1;
        recurrence_days = JSON.stringify(recurrence.days || []);
        recurrence_times = JSON.stringify(recurrence.times || []);
    }

    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        
        const campaignRes = await client.query(
            "INSERT INTO campaigns (instance_id, name, message, scheduled_at, status, is_recurring, recurrence_days, recurrence_times) VALUES ($1, $2, $3, $4, 'pending', $5, $6, $7) RETURNING id",
            [instanceId, name, message, scheduledAt, is_recurring, recurrence_days, recurrence_times]
        );
        const campaignId = campaignRes.rows[0].id;
        
        const queueQuery = "INSERT INTO campaign_queue (campaign_id, contact_number, status) VALUES ($1, $2, 'pending')";
        for (let num of contactsArray) {
            await client.query(queueQuery, [campaignId, num]);
        }
        
        await client.query('COMMIT');
        return campaignId;
    } catch (e) {
        await client.query('ROLLBACK');
        throw e;
    } finally {
        client.release();
    }
};

const editCampaign = async (campaignId, name, message, scheduledAt, recurrence, contactsArray) => {
    let is_recurring = 0;
    let recurrence_days = null;
    let recurrence_times = null;
    if (recurrence && recurrence.is_recurring) {
        is_recurring = 1;
        recurrence_days = JSON.stringify(recurrence.days || []);
        recurrence_times = JSON.stringify(recurrence.times || []);
    }

    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        
        await client.query(
            `UPDATE campaigns SET name = $1, message = $2, scheduled_at = $3, status = 'pending', is_recurring = $4, recurrence_days = $5, recurrence_times = $6 WHERE id = $7`,
            [name, message, scheduledAt, is_recurring, recurrence_days, recurrence_times, campaignId]
        );
        
        await client.query("DELETE FROM campaign_queue WHERE campaign_id = $1", [campaignId]);
        
        const queueQuery = "INSERT INTO campaign_queue (campaign_id, contact_number, status) VALUES ($1, $2, 'pending')";
        for (let num of contactsArray) {
            await client.query(queueQuery, [campaignId, num]);
        }
        
        await client.query('COMMIT');
        return true;
    } catch (e) {
        await client.query('ROLLBACK');
        throw e;
    } finally {
        client.release();
    }
};

const getCampaigns = async (username = null, role = null) => {
    if (role === 'ADMINISTRADOR' || !username) {
        const query = `
            SELECT c.*, 
            CAST((SELECT COUNT(*) FROM campaign_queue WHERE campaign_id = c.id) AS INTEGER) as total_contacts,
            CAST((SELECT COUNT(*) FROM campaign_queue WHERE campaign_id = c.id AND status = 'sent') AS INTEGER) as sent_contacts
            FROM campaigns c ORDER BY c.id DESC
        `;
        const res = await pool.query(query);
        return res.rows;
    } else {
        const query = `
            SELECT c.*, 
            CAST((SELECT COUNT(*) FROM campaign_queue WHERE campaign_id = c.id) AS INTEGER) as total_contacts,
            CAST((SELECT COUNT(*) FROM campaign_queue WHERE campaign_id = c.id AND status = 'sent') AS INTEGER) as sent_contacts
            FROM campaigns c 
            JOIN instances i ON c.instance_id = i.id
            WHERE i.created_by = $1
            ORDER BY c.id DESC
        `;
        const res = await pool.query(query, [username]);
        return res.rows;
    }
};

const getPendingCampaigns = async () => {
    const res = await pool.query("SELECT * FROM campaigns WHERE status IN ('pending', 'running')");
    return res.rows;
};

const updateCampaignStatus = async (id, status) => {
    await pool.query("UPDATE campaigns SET status = $1 WHERE id = $2", [status, id]);
};

const getNextQueueItem = async (campaignId) => {
    const res = await pool.query("SELECT * FROM campaign_queue WHERE campaign_id = $1 AND status = 'pending' LIMIT 1", [campaignId]);
    return res.rows[0];
};

const updateQueueStatus = async (id, status) => {
    await pool.query("UPDATE campaign_queue SET status = $1 WHERE id = $2", [status, id]);
};

const resetCampaignQueue = async (campaignId) => {
    await pool.query("UPDATE campaign_queue SET status = 'pending' WHERE campaign_id = $1", [campaignId]);
};

const updateCampaignScheduledTime = async (campaignId, newTime) => {
    await pool.query("UPDATE campaigns SET scheduled_at = $1, status = 'pending' WHERE id = $2", [newTime, campaignId]);
};

const getCampaignContacts = async (campaignId) => {
    const res = await pool.query("SELECT contact_number FROM campaign_queue WHERE campaign_id = $1", [campaignId]);
    return res.rows.map(r => r.contact_number);
};

// ==========================
// API & PROJETOS
// ==========================

const getProjects = async (username = null, role = null) => {
    if (role === 'ADMINISTRADOR' || !username) {
        const res = await pool.query("SELECT * FROM projects ORDER BY id DESC");
        return res.rows;
    } else {
        const res = await pool.query("SELECT * FROM projects WHERE created_by = $1 ORDER BY id DESC", [username]);
        return res.rows;
    }
};

const createProject = async (name, website, apiKey, instanceId, createdBy = 'ADMINISTRADOR') => {
    const createdAt = new Date().toLocaleString('pt-BR');
    const res = await pool.query(
        "INSERT INTO projects (name, website, api_key, instance_id, created_at, created_by) VALUES ($1, $2, $3, $4, $5, $6) RETURNING id",
        [name, website, apiKey, instanceId, createdAt, createdBy]
    );
    return res.rows[0].id;
};

const deleteProject = async (id) => {
    await pool.query("DELETE FROM projects WHERE id = $1", [id]);
    return true;
};

const updateProject = async (id, name, website, instanceId) => {
    await pool.query(
        "UPDATE projects SET name = $1, website = $2, instance_id = $3 WHERE id = $4",
        [name, website, instanceId, id]
    );
    return true;
};

const validateApiKey = async (apiKey) => {
    const res = await pool.query("SELECT * FROM projects WHERE api_key = $1", [apiKey]);
    return res.rows[0] || null;
};

const validateUser = async (loginIdentifier, password) => {
    const hash = hashPassword(password);
    const res = await pool.query("SELECT * FROM users WHERE (UPPER(username) = UPPER($1) OR UPPER(email) = UPPER($1)) AND password_hash = $2", [loginIdentifier, hash]);
    return res.rows[0] || null;
};

const changeUserPassword = async (username, newPassword) => {
    const hash = hashPassword(newPassword);
    await pool.query("UPDATE users SET password_hash = $1 WHERE UPPER(username) = UPPER($2)", [hash, username]);
    return true;
};

const optOutContact = async (instanceId, number) => {
    await pool.query("UPDATE contacts SET opt_out = 1 WHERE instance_id = $1 AND number = $2", [instanceId, number]);
};

const getContactByNumber = async (instanceId, number) => {
    const res = await pool.query("SELECT * FROM contacts WHERE instance_id = $1 AND number = $2", [instanceId, number]);
    return res.rows[0] || null;
};

const logApiRequest = async (projectId, endpoint, method, statusCode) => {
    try {
        await pool.query(
            "INSERT INTO api_logs (project_id, endpoint, method, status_code) VALUES ($1, $2, $3, $4)",
            [projectId, endpoint, method, statusCode]
        );
    } catch (e) {
        console.error("Erro ao salvar log de API:", e);
    }
};

const getProjectMetrics = async (projectId) => {
    const res = await pool.query(`
        SELECT 
            TO_CHAR(created_at, 'YYYY-MM-DD') as date,
            COUNT(*) as total,
            SUM(CASE WHEN status_code >= 400 THEN 1 ELSE 0 END) as errors
        FROM api_logs
        WHERE project_id = $1 AND created_at >= NOW() - INTERVAL '30 days'
        GROUP BY TO_CHAR(created_at, 'YYYY-MM-DD')
        ORDER BY TO_CHAR(created_at, 'YYYY-MM-DD') ASC
    `, [projectId]);
    
    const endpointsRes = await pool.query(`
        SELECT endpoint, COUNT(*) as count 
        FROM api_logs 
        WHERE project_id = $1 AND created_at >= NOW() - INTERVAL '30 days'
        GROUP BY endpoint 
        ORDER BY count DESC LIMIT 5
    `, [projectId]);

    return {
        daily: res.rows,
        endpoints: endpointsRes.rows
    };
};

const createUser = async (fullName, cpf, address, email, username, password, googleId = null, role = 'USUARIO') => {
    const passwordHash = password ? hashPassword(password) : null;
    const nowStr = new Date().toLocaleString('pt-BR');
    const res = await pool.query(
        `INSERT INTO users (username, password_hash, created_at, full_name, cpf, address, email, role, google_id) 
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING username`,
        [username, passwordHash, nowStr, fullName, cpf, address, email, role, googleId]
    );
    return res.rows[0].username;
};

const getUsers = async () => {
    const res = await pool.query("SELECT username, full_name, cpf, address, email, role, created_at FROM users ORDER BY username ASC");
    return res.rows;
};

const updateUserRole = async (username, role) => {
    await pool.query("UPDATE users SET role = $1 WHERE username = $2", [role, username]);
    return true;
};

const deleteUser = async (username) => {
    await pool.query("DELETE FROM users WHERE username = $1", [username]);
    return true;
};

const checkUsernameExists = async (username) => {
    const res = await pool.query("SELECT COUNT(*) FROM users WHERE UPPER(username) = UPPER($1)", [username]);
    return parseInt(res.rows[0].count, 10) > 0;
};

const checkEmailExists = async (email) => {
    const res = await pool.query("SELECT COUNT(*) FROM users WHERE UPPER(email) = UPPER($1)", [email]);
    return parseInt(res.rows[0].count, 10) > 0;
};

const getUserByGoogleId = async (googleId) => {
    const res = await pool.query("SELECT * FROM users WHERE google_id = $1", [googleId]);
    return res.rows[0] || null;
};

const getUserByEmail = async (email) => {
    const res = await pool.query("SELECT * FROM users WHERE UPPER(email) = UPPER($1)", [email]);
    return res.rows[0] || null;
};

const linkGoogleId = async (username, googleId) => {
    await pool.query("UPDATE users SET google_id = $1 WHERE username = $2", [googleId, username]);
    return true;
};

module.exports = {
    initPromise,
    getInstances,
    saveInstance,
    deleteInstanceDb,
    saveContacts,
    getContacts,
    optOutContact,
    getContactByNumber,
    createCampaign,
    getCampaigns,
    getPendingCampaigns,
    updateCampaignStatus,
    getNextQueueItem,
    updateQueueStatus,
    editCampaign,
    resetCampaignQueue,
    updateCampaignScheduledTime,
    getCampaignContacts,
    getProjects,
    createProject,
    deleteProject,
    updateProject,
    validateApiKey,
    validateUser,
    changeUserPassword,
    logApiRequest,
    getProjectMetrics,
    createUser,
    getUsers,
    updateUserRole,
    deleteUser,
    checkUsernameExists,
    checkEmailExists,
    getUserByGoogleId,
    getUserByEmail,
    linkGoogleId
};
