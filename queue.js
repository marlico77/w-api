/**
 * ZAP API - Motor de Fila Nativa em PostgreSQL
 * Substitui a dependência do Redis por um loop seguro no banco de dados com Rate Limit nativo.
 */

const db = require('./database');
const { instances } = require('./whatsappClient');

const DELAY_BETWEEN_MESSAGES_MS = 25000; // 25 segundos
let circuitBreakers = {}; // instanceId -> timestamp until paused
let lastSendTimes = {}; // instanceId -> timestamp do último envio
let isProcessing = false;

// Helpers de Data
function getBrasiliaDateObject(date) {
    const formatter = new Intl.DateTimeFormat('en-US', {
        timeZone: 'America/Sao_Paulo',
        year: 'numeric', month: 'numeric', day: 'numeric',
        hour: 'numeric', minute: 'numeric', second: 'numeric',
        hour12: false
    });
    const parts = formatter.formatToParts(date);
    const map = {};
    for (const part of parts) { map[part.type] = part.value; }
    let hour = parseInt(map.hour, 10);
    if (hour === 24) hour = 0; 
    return new Date(Date.UTC(parseInt(map.year, 10), parseInt(map.month, 10) - 1, parseInt(map.day, 10), hour, parseInt(map.minute, 10), parseInt(map.second, 10)));
}

function parseScheduledDate(scheduledAtStr) {
    if (!scheduledAtStr) return new Date(0);
    try {
        const [datePart, timePart] = scheduledAtStr.split('T');
        if (!datePart || !timePart) return getBrasiliaDateObject(new Date(scheduledAtStr));
        const [year, month, day] = datePart.split('-').map(Number);
        const [hour, minute] = timePart.split(':').map(Number);
        return new Date(Date.UTC(year, month - 1, day, hour, minute, 0, 0));
    } catch (e) { return new Date(0); }
}

function formatDateTimeLocalUTC(date) {
    const pad = (n) => n.toString().padStart(2, '0');
    return `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())}T${pad(date.getUTCHours())}:${pad(date.getUTCMinutes())}`;
}

function getNextOccurrence(nowBr, days, times) {
    if (!days || !days.length || !times || !times.length) return null;
    const sortedTimes = times.sort();
    const today = nowBr.getUTCDay();
    
    if (days.includes(today)) {
        const currentHourStr = nowBr.getUTCHours().toString().padStart(2, '0') + ':' + nowBr.getUTCMinutes().toString().padStart(2, '0');
        for (let time of sortedTimes) {
            if (time > currentHourStr) {
                const [h, m] = time.split(':');
                const next = new Date(nowBr);
                next.setUTCHours(parseInt(h, 10), parseInt(m, 10), 0, 0);
                return next;
            }
        }
    }
    
    for (let i = 1; i <= 7; i++) {
        const nextDay = (today + i) % 7;
        if (days.includes(nextDay)) {
            const time = sortedTimes[0];
            const [h, m] = time.split(':');
            const next = new Date(nowBr);
            next.setUTCDate(next.getUTCDate() + i);
            next.setUTCHours(parseInt(h, 10), parseInt(m, 10), 0, 0);
            return next;
        }
    }
    return null;
}

async function processQueue() {
    if (isProcessing) return;
    isProcessing = true;

    try {
        const campaigns = await db.getPendingCampaigns();
        const nowBr = getBrasiliaDateObject(new Date());
        const now = Date.now();

        for (const campaign of campaigns) {
            const scheduled = parseScheduledDate(campaign.scheduled_at);
            if (nowBr >= scheduled) {
                
                // 1. Checar Circuit Breaker
                if (circuitBreakers[campaign.instance_id] && now < circuitBreakers[campaign.instance_id]) {
                    continue; 
                }

                // 2. Checar Delay de Throttling da instância (Ex: 25 segundos)
                const lastSend = lastSendTimes[campaign.instance_id] || 0;
                if (now - lastSend < DELAY_BETWEEN_MESSAGES_MS) {
                    continue; // Pula essa instância nesta rodada do loop (cooldown em andamento)
                }

                const instance = instances.get(campaign.instance_id);
                if (!instance || instance.status !== 'CONNECTED') {
                    continue; 
                }

                if (campaign.status === 'pending') {
                    console.log(`[Queue PG] Iniciando Campanha #${campaign.id} (${campaign.name})`);
                    await db.updateCampaignStatus(campaign.id, 'running');
                }

                // 3. Puxar próximo item do banco de dados (Apenas pendentes)
                const nextItem = await db.getNextQueueItem(campaign.id);
                
                if (nextItem) {
                    // Bloqueio preventivo (lock state em banco) para evitar duplo processamento
                    await db.updateQueueStatus(nextItem.id, 'processing');

                    // 4. Checar Opt-Out Rígido
                    const contact = await db.getContactByNumber(campaign.instance_id, nextItem.contact_number);
                    if (contact && contact.opt_out === 1) {
                        console.log(`[Queue PG] Disparo bloqueado pelo Opt-Out: Contato ${nextItem.contact_number}.`);
                        await db.updateQueueStatus(nextItem.id, 'cancelled_optout');
                        continue; // Passa para a próxima campanha (sem aplicar o cooldown de 25s, pois não enviou)
                    }

                    console.log(`[Queue PG] Campanha #${campaign.id}: Disparando mensagem para ${nextItem.contact_number}`);
                    try {
                        const chatId = nextItem.contact_number.includes('@') ? nextItem.contact_number : `${nextItem.contact_number}@c.us`;
                        await instance.client.sendMessage(chatId, campaign.message);
                        
                        await db.updateQueueStatus(nextItem.id, 'sent');
                        
                        // Atualiza timestamp para o Cooldown Anti-Spam (só envia na próxima passagem do loop após 25s)
                        lastSendTimes[campaign.instance_id] = Date.now();

                    } catch (err) {
                        console.error(`[Queue PG] Falha ao enviar para ${nextItem.contact_number}:`, err.message);
                        await db.updateQueueStatus(nextItem.id, 'failed');
                        
                        // Circuit Breaker: Desconexão por violação ou queda
                        if (err.message.includes('Session closed') || err.message.includes('disconnected')) {
                            console.error(`[CIRCUIT BREAKER] Instância ${campaign.instance_id} desconectada. Fila pausada por 10 minutos!`);
                            circuitBreakers[campaign.instance_id] = Date.now() + 10 * 60 * 1000;
                        }
                    }
                } else {
                    // Fila Vazia para esta campanha (Todos em sent, failed ou cancelled)
                    if (campaign.is_recurring) {
                        let parsedDays = [];
                        let parsedTimes = [];
                        try { if (campaign.recurrence_days) parsedDays = JSON.parse(campaign.recurrence_days); } catch(e){}
                        try { if (campaign.recurrence_times) parsedTimes = JSON.parse(campaign.recurrence_times); } catch(e){}
                        
                        const nextDate = getNextOccurrence(nowBr, parsedDays, parsedTimes);
                        if (nextDate) {
                            const newScheduledAt = formatDateTimeLocalUTC(nextDate);
                            console.log(`[Queue PG] Campanha #${campaign.id} reagendada para a próxima recorrência: ${newScheduledAt}.`);
                            await db.updateCampaignScheduledTime(campaign.id, newScheduledAt);
                            await db.resetCampaignQueue(campaign.id);
                        } else {
                            console.log(`[Queue PG] Campanha #${campaign.id} finalizada (Sem ocorrências ativas).`);
                            await db.updateCampaignStatus(campaign.id, 'finished');
                        }
                    } else {
                        console.log(`[Queue PG] Campanha #${campaign.id} finalizada com sucesso!`);
                        await db.updateCampaignStatus(campaign.id, 'finished');
                    }
                }
            }
        }
    } catch (err) {
        console.error('[Queue PG] Erro crítico no motor principal:', err);
    } finally {
        isProcessing = false;
    }
}

function startScheduler() {
    console.log('[Sistema] Motor de Fila Nativa (PostgreSQL) + Throttling 25s ativado.');
    // Loop ágil: roda a cada 5 segundos para verificar o banco de dados. 
    // O Rate Limit é imposto pela variável `lastSendTimes` por instância.
    setInterval(processQueue, 5000);
}

module.exports = { startScheduler };
