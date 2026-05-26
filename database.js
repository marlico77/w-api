const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const fs = require('fs');

const dbPath = path.join(__dirname, 'database.sqlite');
const db = new sqlite3.Database(dbPath);

db.serialize(() => {
    db.run(`CREATE TABLE IF NOT EXISTS instances (
        id TEXT PRIMARY KEY,
        token TEXT,
        createdAt TEXT,
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

    db.run(`CREATE TABLE IF NOT EXISTS contacts (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        instance_id TEXT,
        number TEXT,
        name TEXT,
        isGroup INTEGER DEFAULT 0,
        UNIQUE(instance_id, number)
    )`);

    db.run(`CREATE TABLE IF NOT EXISTS campaigns (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        instance_id TEXT,
        name TEXT,
        message TEXT,
        scheduled_at TEXT,
        status TEXT DEFAULT 'pending',
        is_recurring INTEGER DEFAULT 0,
        recurrence_days TEXT,
        recurrence_times TEXT
    )`);
    
    // Add columns to existing table safely
    db.run(`ALTER TABLE campaigns ADD COLUMN is_recurring INTEGER DEFAULT 0`, () => {});
    db.run(`ALTER TABLE campaigns ADD COLUMN recurrence_days TEXT`, () => {});
    db.run(`ALTER TABLE campaigns ADD COLUMN recurrence_times TEXT`, () => {});

    db.run(`CREATE TABLE IF NOT EXISTS campaign_queue (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        campaign_id INTEGER,
        contact_number TEXT,
        status TEXT DEFAULT 'pending'
    )`);

    db.run(`CREATE TABLE IF NOT EXISTS projects (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT,
        website TEXT,
        api_key TEXT UNIQUE,
        created_at TEXT
    )`);
});

const getInstances = () => {
    return new Promise((resolve, reject) => {
        db.all("SELECT * FROM instances", (err, rows) => {
            if (err) reject(err);
            else resolve(rows);
        });
    });
};

const saveInstance = (data) => {
    return new Promise((resolve, reject) => {
        db.run(`INSERT OR REPLACE INTO instances (
            id, token, createdAt, 
            wh_message_in, wh_message_out, wh_connect, wh_disconnect, wh_status, wh_presence,
            notify_own_msg, opt_reject_call, opt_read_msg, opt_read_status, opt_disable_queue
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
            data.id, data.token, data.createdAt,
            data.wh_message_in || '', data.wh_message_out || '', data.wh_connect || '', 
            data.wh_disconnect || '', data.wh_status || '', data.wh_presence || '',
            data.notify_own_msg ? 1 : 0, data.opt_reject_call ? 1 : 0, 
            data.opt_read_msg ? 1 : 0, data.opt_read_status ? 1 : 0, data.opt_disable_queue ? 1 : 0
        ], function(err) {
            if (err) reject(err);
            else resolve(true);
        });
    });
};

const deleteInstanceDb = (id) => {
    return new Promise((resolve, reject) => {
        db.run("DELETE FROM instances WHERE id = ?", [id], function(err) {
            if (err) reject(err);
            else resolve(true);
        });
    });
};

// ==========================
// CONTATOS
// ==========================
const saveContacts = (instanceId, contactsList) => {
    return new Promise((resolve, reject) => {
        db.serialize(() => {
            db.run("BEGIN TRANSACTION");
            const stmt = db.prepare("INSERT OR REPLACE INTO contacts (instance_id, number, name, isGroup) VALUES (?, ?, ?, ?)");
            for (let c of contactsList) {
                stmt.run(instanceId, c.number, c.name, c.isGroup ? 1 : 0);
            }
            stmt.finalize();
            db.run("COMMIT", (err) => {
                if (err) reject(err);
                else resolve(true);
            });
        });
    });
};

const getContacts = (instanceId) => {
    return new Promise((resolve, reject) => {
        db.all("SELECT * FROM contacts WHERE instance_id = ?", [instanceId], (err, rows) => {
            if (err) reject(err);
            else resolve(rows);
        });
    });
};

// ==========================
// CAMPANHAS
// ==========================
const createCampaign = (instanceId, name, message, scheduledAt, contactsArray, recurrence = null) => {
    return new Promise((resolve, reject) => {
        let is_recurring = 0;
        let recurrence_days = null;
        let recurrence_times = null;
        if (recurrence && recurrence.is_recurring) {
            is_recurring = 1;
            recurrence_days = JSON.stringify(recurrence.days || []);
            recurrence_times = JSON.stringify(recurrence.times || []);
        }

        db.run("INSERT INTO campaigns (instance_id, name, message, scheduled_at, status, is_recurring, recurrence_days, recurrence_times) VALUES (?, ?, ?, ?, 'pending', ?, ?, ?)",
        [instanceId, name, message, scheduledAt, is_recurring, recurrence_days, recurrence_times], function(err) {
            if (err) return reject(err);
            const campaignId = this.lastID;
            
            const stmt = db.prepare("INSERT INTO campaign_queue (campaign_id, contact_number, status) VALUES (?, ?, 'pending')");
            for (let num of contactsArray) {
                stmt.run(campaignId, num);
            }
            stmt.finalize();
            resolve(campaignId);
        });
    });
};

const editCampaign = (campaignId, name, message, scheduledAt, recurrence, contactsArray) => {
    return new Promise((resolve, reject) => {
        let is_recurring = 0;
        let recurrence_days = null;
        let recurrence_times = null;
        if (recurrence && recurrence.is_recurring) {
            is_recurring = 1;
            recurrence_days = JSON.stringify(recurrence.days || []);
            recurrence_times = JSON.stringify(recurrence.times || []);
        }

        db.run(`UPDATE campaigns SET name = ?, message = ?, scheduled_at = ?, status = 'pending', is_recurring = ?, recurrence_days = ?, recurrence_times = ? WHERE id = ?`,
        [name, message, scheduledAt, is_recurring, recurrence_days, recurrence_times, campaignId], function(err) {
            if (err) return reject(err);
            
            // Re-create queue
            db.run("DELETE FROM campaign_queue WHERE campaign_id = ?", [campaignId], (err2) => {
                if (err2) return reject(err2);
                
                const stmt = db.prepare("INSERT INTO campaign_queue (campaign_id, contact_number, status) VALUES (?, ?, 'pending')");
                for (let num of contactsArray) {
                    stmt.run(campaignId, num);
                }
                stmt.finalize();
                resolve(true);
            });
        });
    });
};

const getCampaigns = () => {
    return new Promise((resolve, reject) => {
        db.all(`SELECT c.*, 
                (SELECT COUNT(*) FROM campaign_queue WHERE campaign_id = c.id) as total_contacts,
                (SELECT COUNT(*) FROM campaign_queue WHERE campaign_id = c.id AND status = 'sent') as sent_contacts
                FROM campaigns c ORDER BY c.id DESC`, (err, rows) => {
            if (err) reject(err);
            else resolve(rows);
        });
    });
};

const getPendingCampaigns = () => {
    return new Promise((resolve, reject) => {
        db.all("SELECT * FROM campaigns WHERE status IN ('pending', 'running')", (err, rows) => {
            if (err) reject(err);
            else resolve(rows);
        });
    });
};

const updateCampaignStatus = (id, status) => {
    return new Promise((resolve) => {
        db.run("UPDATE campaigns SET status = ? WHERE id = ?", [status, id], () => resolve());
    });
};

const getNextQueueItem = (campaignId) => {
    return new Promise((resolve, reject) => {
        db.get("SELECT * FROM campaign_queue WHERE campaign_id = ? AND status = 'pending' LIMIT 1", [campaignId], (err, row) => {
            if (err) reject(err);
            else resolve(row);
        });
    });
};

const updateQueueStatus = (id, status) => {
    return new Promise((resolve) => {
        db.run("UPDATE campaign_queue SET status = ? WHERE id = ?", [status, id], () => resolve());
    });
};

const resetCampaignQueue = (campaignId) => {
    return new Promise((resolve) => {
        db.run("UPDATE campaign_queue SET status = 'pending' WHERE campaign_id = ?", [campaignId], () => resolve());
    });
};

const updateCampaignScheduledTime = (campaignId, newTime) => {
    return new Promise((resolve) => {
        db.run("UPDATE campaigns SET scheduled_at = ?, status = 'pending' WHERE id = ?", [newTime, campaignId], () => resolve());
    });
};

const getCampaignContacts = (campaignId) => {
    return new Promise((resolve, reject) => {
        db.all("SELECT contact_number FROM campaign_queue WHERE campaign_id = ?", [campaignId], (err, rows) => {
            if (err) reject(err);
            else resolve(rows.map(r => r.contact_number));
        });
    });
};

// ==========================
// API & PROJETOS
// ==========================

const getProjects = () => {
    return new Promise((resolve, reject) => {
        db.all("SELECT * FROM projects ORDER BY id DESC", (err, rows) => {
            if (err) reject(err);
            else resolve(rows);
        });
    });
};

const createProject = (name, website, apiKey) => {
    return new Promise((resolve, reject) => {
        const createdAt = new Date().toLocaleString('pt-BR');
        db.run("INSERT INTO projects (name, website, api_key, created_at) VALUES (?, ?, ?, ?)",
            [name, website, apiKey, createdAt],
            function(err) {
                if (err) reject(err);
                else resolve(this.lastID);
            }
        );
    });
};

const deleteProject = (id) => {
    return new Promise((resolve, reject) => {
        db.run("DELETE FROM projects WHERE id = ?", [id], function(err) {
            if (err) reject(err);
            else resolve(true);
        });
    });
};

const validateApiKey = (apiKey) => {
    return new Promise((resolve, reject) => {
        db.get("SELECT * FROM projects WHERE api_key = ?", [apiKey], (err, row) => {
            if (err) reject(err);
            else resolve(!!row);
        });
    });
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
    validateApiKey
};
