const { Pool } = require('pg');
require('dotenv').config();

const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: {
        rejectUnauthorized: false
    }
});

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
        console.log('✅ PostgreSQL tables checked/created successfully');
    } catch (err) {
        console.error('❌ Error initializing database:', err);
    }
};

initDb();

const getInstances = async () => {
    const res = await pool.query("SELECT * FROM instances");
    return res.rows;
};

const saveInstance = async (data) => {
    const query = `
        INSERT INTO instances (
            id, token, "createdAt", 
            wh_message_in, wh_message_out, wh_connect, wh_disconnect, wh_status, wh_presence,
            notify_own_msg, opt_reject_call, opt_read_msg, opt_read_status, opt_disable_queue
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
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
            opt_disable_queue = EXCLUDED.opt_disable_queue
    `;
    await pool.query(query, [
        data.id, data.token, data.createdAt,
        data.wh_message_in || '', data.wh_message_out || '', data.wh_connect || '', 
        data.wh_disconnect || '', data.wh_status || '', data.wh_presence || '',
        data.notify_own_msg ? 1 : 0, data.opt_reject_call ? 1 : 0, 
        data.opt_read_msg ? 1 : 0, data.opt_read_status ? 1 : 0, data.opt_disable_queue ? 1 : 0
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

const getCampaigns = async () => {
    const query = `
        SELECT c.*, 
        CAST((SELECT COUNT(*) FROM campaign_queue WHERE campaign_id = c.id) AS INTEGER) as total_contacts,
        CAST((SELECT COUNT(*) FROM campaign_queue WHERE campaign_id = c.id AND status = 'sent') AS INTEGER) as sent_contacts
        FROM campaigns c ORDER BY c.id DESC
    `;
    const res = await pool.query(query);
    return res.rows;
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

const getProjects = async () => {
    const res = await pool.query("SELECT * FROM projects ORDER BY id DESC");
    return res.rows;
};

const createProject = async (name, website, apiKey, instanceId) => {
    const createdAt = new Date().toLocaleString('pt-BR');
    const res = await pool.query(
        "INSERT INTO projects (name, website, api_key, instance_id, created_at) VALUES ($1, $2, $3, $4, $5) RETURNING id",
        [name, website, apiKey, instanceId, createdAt]
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

module.exports = {
    getInstances,
    saveInstance,
    deleteInstanceDb,
    saveContacts,
    getContacts,
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
    validateApiKey
};
