const db = require('./database');
const { instances } = require('./whatsappClient');

const ANTI_SPAM_DELAY_MS = 37 * 1000; // 37 segundos configurados pelo usuário
let isProcessing = false;

function formatDateTimeLocal(date) {
    const pad = (n) => n.toString().padStart(2, '0');
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function getNextOccurrence(now, days, times) {
    if (!days || !days.length || !times || !times.length) return null;
    
    const sortedTimes = times.sort();
    const today = now.getDay();
    
    // Check today first
    if (days.includes(today)) {
        const currentHourStr = now.getHours().toString().padStart(2, '0') + ':' + now.getMinutes().toString().padStart(2, '0');
        for (let time of sortedTimes) {
            if (time > currentHourStr) {
                const [h, m] = time.split(':');
                const next = new Date(now);
                next.setHours(parseInt(h, 10), parseInt(m, 10), 0, 0);
                return next;
            }
        }
    }
    
    // Check upcoming days
    for (let i = 1; i <= 7; i++) {
        const nextDay = (today + i) % 7;
        if (days.includes(nextDay)) {
            const time = sortedTimes[0];
            const [h, m] = time.split(':');
            const next = new Date(now);
            next.setDate(next.getDate() + i);
            next.setHours(parseInt(h, 10), parseInt(m, 10), 0, 0);
            return next;
        }
    }
    
    return null;
}

async function processCampaigns() {
    if (isProcessing) return;
    isProcessing = true;

    try {
        const campaigns = await db.getPendingCampaigns();
        const now = new Date();

        for (const campaign of campaigns) {
            // Verificar se a data/hora agendada já chegou ou passou
            const scheduled = new Date(campaign.scheduled_at);
            if (now >= scheduled) {
                // Checar se a instância está conectada
                const instance = instances.get(campaign.instance_id);
                if (!instance || instance.status !== 'CONNECTED') {
                    console.log(`[Scheduler] Campanha #${campaign.id} aguardando instância ${campaign.instance_id} conectar...`);
                    continue; // Pula essa campanha por enquanto
                }

                if (campaign.status === 'pending') {
                    console.log(`[Scheduler] Iniciando Campanha #${campaign.id} (${campaign.name})`);
                    await db.updateCampaignStatus(campaign.id, 'running');
                }

                // Tentar pegar o próximo contato da fila
                const nextItem = await db.getNextQueueItem(campaign.id);
                
                if (nextItem) {
                    console.log(`[Scheduler] Campanha #${campaign.id}: Disparando mensagem para ${nextItem.contact_number}`);
                    
                    try {
                        const chatId = nextItem.contact_number.includes('@') ? nextItem.contact_number : `${nextItem.contact_number}@c.us`;
                        await instance.client.sendMessage(chatId, campaign.message);
                        await db.updateQueueStatus(nextItem.id, 'sent');
                        
                        console.log(`[Scheduler] Mensagem enviada com sucesso! Aguardando ${ANTI_SPAM_DELAY_MS/1000}s de Anti-Spam...`);
                        
                        // Espera o Delay Anti-Spam
                        await new Promise(resolve => setTimeout(resolve, ANTI_SPAM_DELAY_MS));

                    } catch (err) {
                        console.error(`[Scheduler] Falha ao enviar para ${nextItem.contact_number}:`, err.message);
                        await db.updateQueueStatus(nextItem.id, 'failed');
                        // Falhas também esperam um pequeno delay pra não engarrafar
                        await new Promise(resolve => setTimeout(resolve, 5000));
                    }
                } else {
                    // Fila vazia = Campanha finalizada
                    if (campaign.is_recurring) {
                        let parsedDays = [];
                        let parsedTimes = [];
                        try { if (campaign.recurrence_days) parsedDays = JSON.parse(campaign.recurrence_days); } catch(e){}
                        try { if (campaign.recurrence_times) parsedTimes = JSON.parse(campaign.recurrence_times); } catch(e){}
                        
                        const nextDate = getNextOccurrence(now, parsedDays, parsedTimes);
                        if (nextDate) {
                            const newScheduledAt = formatDateTimeLocal(nextDate);
                            console.log(`[Scheduler] Campanha #${campaign.id} se repete. Reagendando para ${newScheduledAt}...`);
                            await db.updateCampaignScheduledTime(campaign.id, newScheduledAt);
                            await db.resetCampaignQueue(campaign.id);
                        } else {
                            console.log(`[Scheduler] Campanha #${campaign.id} finalizada com sucesso! (Recorrência inválida)`);
                            await db.updateCampaignStatus(campaign.id, 'finished');
                        }
                    } else {
                        console.log(`[Scheduler] Campanha #${campaign.id} finalizada com sucesso!`);
                        await db.updateCampaignStatus(campaign.id, 'finished');
                    }
                }
            }
        }
    } catch (err) {
        console.error('[Scheduler] Erro no loop de processamento:', err);
    } finally {
        isProcessing = false;
    }
}

function startScheduler() {
    console.log('[Sistema] Motor de Campanhas e Anti-Spam (37s) iniciado.');
    // Roda o loop a cada 5 segundos para checar a fila
    // (O tempo de bloqueio é gerenciado no próprio loop pelo await e setTimeout)
    setInterval(processCampaigns, 5000);
}

module.exports = { startScheduler };
