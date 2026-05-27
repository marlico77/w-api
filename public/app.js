const API_BASE = window.location.origin;

// Navegação
const navItems = document.querySelectorAll('.nav-item');
const views = document.querySelectorAll('.view-section');

// Elementos - Instâncias
const tbodyInstances = document.getElementById('instances-tbody');
const lblTotalInst = document.getElementById('lbl-total-inst');
const lblTotalConn = document.getElementById('lbl-total-conn');
const lblTotalDisc = document.getElementById('lbl-total-disc');
const btnAddInstance = document.getElementById('btn-add-instance');

// Elementos - Dashboard da Instância
const spanInstanceId = document.getElementById('current-instance-id');
const elStateStarting = document.getElementById('state-starting');
const elStateQr = document.getElementById('state-qr');
const elStateConnected = document.getElementById('state-connected');
const elQrBox = document.getElementById('qrcode-box');
const elLogsContainer = document.getElementById('logs-container');
const elCountOut = document.getElementById('count-out');
const elCountIn = document.getElementById('count-in');
const formSend = document.getElementById('send-form');
const feedbackMsg = document.getElementById('send-feedback');
const btnDisconnectInstance = document.getElementById('btn-disconnect-instance');

let currentView = 'view-instances';
let activeInstanceId = null;
let qrcodeObj = null;
let lastStatus = '';
let pollInterval = null;

// Roteamento Simples
navItems.forEach(item => {
    item.addEventListener('click', (e) => {
        e.preventDefault();
        const target = item.getAttribute('data-target');
        if ((target === 'view-dashboard' || target === 'view-chat') && !activeInstanceId) {
            alert('Selecione uma instância na aba "Instâncias Web" primeiro.');
            return;
        }
        switchView(target);
        navItems.forEach(nav => nav.classList.remove('active'));
        item.classList.add('active');
    });
});

function switchView(viewId) {
    views.forEach(v => v.classList.add('hidden'));
    document.getElementById(viewId).classList.remove('hidden');
    currentView = viewId;
    
    // Fechar SSE se mudar de tela
    if (typeof closeChatSSE === 'function') closeChatSSE();
    
    // Atualizar títulos na Topbar de forma elegante
    const titleEl = document.getElementById('page-title-text');
    const subtitleEl = document.getElementById('page-subtitle-text');
    if (titleEl && subtitleEl) {
        if (viewId === 'view-instances') {
            titleEl.textContent = 'Instâncias Web';
            subtitleEl.textContent = 'Listagem de instâncias web';
        } else if (viewId === 'view-dashboard') {
            titleEl.textContent = 'Dashboard';
            subtitleEl.textContent = `Gerenciamento da instância: ${activeInstanceId}`;
        } else if (viewId === 'view-chat') {
            titleEl.textContent = 'Chat Integrado';
            subtitleEl.textContent = `Conversas em tempo real da instância: ${activeInstanceId}`;
        } else if (viewId === 'view-campaigns') {
            titleEl.textContent = 'Mensagens Automáticas';
            subtitleEl.textContent = 'Envios em lote e campanhas agendadas';
        } else if (viewId === 'view-projects') {
            titleEl.textContent = 'Projetos (API)';
            subtitleEl.textContent = 'Gerenciamento de chaves de API e integração';
        } else if (viewId === 'view-documentation') {
            titleEl.textContent = 'Documentação';
            subtitleEl.textContent = 'Guia de integração e uso da API';
        } else if (viewId === 'view-form') {
            titleEl.textContent = 'Configurações de Instância';
            subtitleEl.textContent = 'Configurar dados e webhooks da instância';
        }
    }
    
    clearInterval(pollInterval);
    if (viewId === 'view-instances') {
        fetchInstances();
        pollInterval = setInterval(fetchInstances, 3000);
    } else if (viewId === 'view-dashboard') {
        lastStatus = '';
        fetchInstanceData();
        pollInterval = setInterval(fetchInstanceData, 3000);
    } else if (viewId === 'view-chat') {
        initChatView();
    }
}

// ==========================
// TOAST NOTIFICATIONS
// ==========================
window.showToast = (title, message, type = 'success') => {
    const container = document.getElementById('toast-container');
    if (!container) return;

    const toast = document.createElement('div');
    toast.className = `toast ${type}`;
    
    let icon = 'fa-check-circle';
    if (type === 'error') icon = 'fa-circle-xmark';
    if (type === 'info') icon = 'fa-circle-info';

    toast.innerHTML = `
        <div class="toast-icon"><i class="fa-solid ${icon}"></i></div>
        <div class="toast-content">
            <h4>${title}</h4>
            <p>${message}</p>
        </div>
    `;

    // Click to close
    toast.onclick = () => {
        toast.style.animation = 'slideOut 0.3s ease forwards';
        setTimeout(() => toast.remove(), 300);
    };

    container.appendChild(toast);

    // Auto remove
    setTimeout(() => {
        if (toast.parentElement) {
            toast.style.animation = 'slideOut 0.3s ease forwards';
            setTimeout(() => toast.remove(), 300);
        }
    }, 5000);
};

// ==========================
// MÓDULO DE CAMPANHAS E CONTATOS
// ==========================

window.closeModal = (id) => {
    document.getElementById(id).classList.add('hidden');
};

// Sincronizar Contatos do Aparelho (Background Task)
let currentRawContacts = [];
let syncIntervals = {};

window.openSyncContactsModal = async (instanceId) => {
    document.getElementById('modal-contacts').classList.remove('hidden');
    const box = document.getElementById('raw_contacts_box');
    
    // Store globally for saving
    window.syncInstanceId = instanceId;
    
    // Mostra o progresso no box
    box.innerHTML = `
        <div style="text-align:center; padding: 20px;">
            <div class="loader" id="loader-contacts"></div>
            <h2 id="sync-progress-text" style="color:var(--primary); margin-top:15px; font-size:2rem;">0%</h2>
            <p style="color:var(--text-muted);">Sincronizando em segundo plano...<br>Você pode fechar esta janela se quiser.</p>
        </div>
    `;
    
    try {
        // Dispara o Início da Sincronização
        const res = await fetch(`${API_BASE}/api/instances/${instanceId}/sync-contacts`, { method: 'POST' });
        if (!res.ok) throw new Error('Não foi possível iniciar sincronização. Instância conectada?');
        
        showToast('Sincronização Iniciada', 'Os contatos estão sendo baixados em segundo plano. Pode navegar normalmente.', 'info');
        
        // Inicia o Polling
        if (!syncIntervals[instanceId]) {
            startSyncPolling(instanceId);
        }
    } catch (e) {
        box.innerHTML = `<p style="color:#ef4444">${e.message}</p>`;
    }
};

function startSyncPolling(instanceId) {
    syncIntervals[instanceId] = setInterval(async () => {
        try {
            const res = await fetch(`${API_BASE}/api/instances/${instanceId}/raw-contacts`);
            if (!res.ok) return;
            const data = await res.json();
            
            // Atualiza barra se modal estiver aberto para a mesma instancia
            if (window.syncInstanceId === instanceId && document.getElementById('sync-progress-text')) {
                document.getElementById('sync-progress-text').innerText = data.progress + '%';
            }
            
            if (data.status === 'done') {
                clearInterval(syncIntervals[instanceId]);
                delete syncIntervals[instanceId];
                
                showToast('Contatos Sincronizados!', 'O download de contatos do celular foi concluído com sucesso.', 'success');
                
                // Ordenação: Letras (1) -> Números não salvos (2) -> Caracteres/Símbolos (3)
                const sortedContacts = data.contacts.sort((a, b) => {
                    const getCat = (c) => {
                        const n = c.name.trim();
                        if (n === c.number || /^\d+$/.test(n)) return 2; // Número cru
                        if (/^[a-zA-ZÀ-ÿ]/i.test(n)) return 1; // Começa com letra
                        return 3; // Símbolos, emojis, etc
                    };
                    
                    const catA = getCat(a);
                    const catB = getCat(b);
                    
                    if (catA !== catB) return catA - catB;
                    if (catA === 2) return a.number.localeCompare(b.number);
                    return a.name.localeCompare(b.name, 'pt-BR');
                });
                
                // Se modal estiver aberto pra essa instancia, renderiza!
                if (window.syncInstanceId === instanceId && !document.getElementById('modal-contacts').classList.contains('hidden')) {
                    currentRawContacts = sortedContacts;
                    renderRawContacts(sortedContacts);
                }
            } else if (data.status === 'error') {
                clearInterval(syncIntervals[instanceId]);
                delete syncIntervals[instanceId];
                showToast('Erro de Sincronização', 'Falha ao baixar contatos.', 'error');
                if (window.syncInstanceId === instanceId && !document.getElementById('modal-contacts').classList.contains('hidden')) {
                    document.getElementById('raw_contacts_box').innerHTML = `<p style="color:#ef4444">Erro ao sincronizar.</p>`;
                }
            }
        } catch (e) {}
    }, 2000);
}

function formatWhatsAppNumber(numberStr) {
    if (!numberStr) return '';
    const num = String(numberStr).replace(/\D/g, '');
    
    // Grupos ou IDs muito longos
    if (num.length > 15) return num; 
    
    // Brasil - Celular (ex: 55 11 95034-5277)
    if (num.length === 13 && num.startsWith('55')) {
        return `+${num.substring(0,2)} ${num.substring(2,4)} ${num.substring(4,9)}-${num.substring(9)}`;
    }
    // Brasil - Fixo (ex: 55 11 5034-5277)
    if (num.length === 12 && num.startsWith('55')) {
        return `+${num.substring(0,2)} ${num.substring(2,4)} ${num.substring(4,8)}-${num.substring(8)}`;
    }
    // EUA/Canadá (ex: 1 313 555-0002)
    if (num.length === 11 && num.startsWith('1')) {
        return `+${num.substring(0,1)} ${num.substring(1,4)} ${num.substring(4,7)}-${num.substring(7)}`;
    }
    
    return `+${num}`;
}

window.renderRawContacts = (contacts) => {
    const box = document.getElementById('raw_contacts_box');
    
    if (!contacts || contacts.length === 0) {
        box.innerHTML = '<p style="color:var(--text-muted); text-align:center; padding:20px;">Nenhum contato encontrado.</p>';
        return;
    }
    
    // Limita a renderização para não travar o navegador (DOM Freeze)
    const limit = 200;
    const toRender = contacts.slice(0, limit);
    
    let html = '<style>.contact-row:hover { background: rgba(255,255,255,0.05); }</style>';
    toRender.forEach((c, idx) => {
        // Usa o index original do array currentRawContacts para o checkbox funcionar corretamente
        const originalIdx = currentRawContacts.indexOf(c);
        
        const isGroupBadge = c.isGroup ? `<span style="background:var(--primary); color:#fff; font-size:0.6rem; padding:2px 6px; border-radius:10px; margin-left:8px; font-weight:bold; letter-spacing:0.5px;">GRUPO</span>` : '';
        
        html += `
            <label class="contact-row" for="raw_c_${originalIdx}" style="display:flex; align-items:center; gap:15px; margin-bottom:5px; padding:10px 15px; border-bottom:1px solid rgba(255,255,255,0.05); cursor:pointer; transition: background 0.2s; border-radius: 6px; justify-content: flex-start; text-align: left;">
                <input type="checkbox" id="raw_c_${originalIdx}" class="raw-contact-cb" value="${originalIdx}" style="width: 18px; height: 18px; accent-color: var(--primary); cursor:pointer; flex-shrink: 0; margin: 0;">
                <div style="display:flex; flex-direction:column; align-items:flex-start; flex: 1; overflow: hidden;">
                    <span style="color:#fff; font-weight: 500; font-size:0.95rem; text-align: left; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; width: 100%;">${c.name} ${isGroupBadge}</span>
                    <small style="color:var(--text-muted); font-size:0.85rem; margin-top:2px; text-align: left;">${formatWhatsAppNumber(c.number)}</small>
                </div>
            </label>
        `;
    });
    
    if (contacts.length > limit) {
        html += `<p style="color:var(--orange); text-align:center; margin-top:15px; font-size:0.9rem;">Mostrando ${limit} de ${contacts.length} contatos. Use a busca para encontrar específicos.</p>`;
    }
    
    box.innerHTML = html;
};

window.filterRawContacts = () => {
    const term = document.getElementById('search_raw_contacts').value.toLowerCase();
    const filtered = currentRawContacts.filter(c => c.name.toLowerCase().includes(term) || c.number.includes(term));
    renderRawContacts(filtered);
};

window.selectAllRawContacts = (check) => {
    document.querySelectorAll('.raw-contact-cb').forEach(cb => cb.checked = check);
};

window.saveSelectedContacts = async () => {
    const btn = document.getElementById('btn-save-contacts');
    const selectedIndexes = Array.from(document.querySelectorAll('.raw-contact-cb:checked')).map(cb => parseInt(cb.value));
    
    if (selectedIndexes.length === 0) return alert('Selecione ao menos 1 contato');
    
    btn.textContent = 'Salvando...';
    btn.disabled = true;
    
    const contactsToSave = selectedIndexes.map(idx => currentRawContacts[idx]);
    await doSaveContacts(contactsToSave, btn);
};

window.saveAllContacts = async () => {
    if (!currentRawContacts || currentRawContacts.length === 0) return alert('Não há contatos para salvar.');
    if (!confirm(`Tem certeza que deseja salvar TODOS os ${currentRawContacts.length} contatos no banco de dados?`)) return;
    
    const btn = document.getElementById('btn-save-all-contacts') || document.getElementById('btn-save-contacts');
    btn.textContent = 'Salvando Tudo...';
    btn.disabled = true;
    
    await doSaveContacts(currentRawContacts, btn);
};

async function doSaveContacts(contactsToSave, btn) {
    try {
        await fetch(`${API_BASE}/api/instances/${window.syncInstanceId}/contacts`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ contacts: contactsToSave })
        });
        alert(`${contactsToSave.length} contatos salvos com sucesso!`);
        closeModal('modal-contacts');
    } catch (e) {
        alert(e.message);
    } finally {
        if (btn) {
            btn.textContent = btn.id === 'btn-save-all-contacts' ? 'Salvar Todos' : 'Salvar Contatos';
            btn.disabled = false;
        }
    }
}

// Gerenciar Campanhas
let allCampaigns = [];
window.fetchCampaigns = async () => {
    try {
        const res = await fetch(`${API_BASE}/api/campaigns`);
        allCampaigns = await res.json();
        
        const tbody = document.getElementById('tbody-campaigns');
        tbody.innerHTML = '';
        
        allCampaigns.forEach(c => {
            const dateStr = new Date(c.scheduled_at).toLocaleString('pt-BR');
            let statusBadge = `<span class="badge" style="background:#f39c12">Pendente</span>`;
            if (c.status === 'running') statusBadge = `<span class="badge" style="background:#3498db">Rodando</span>`;
            if (c.status === 'finished') statusBadge = `<span class="badge" style="background:#2ecc71">Finalizada</span>`;
            if (c.is_recurring) statusBadge += ` <span class="badge" style="background:#8e44ad"><i class="fa-solid fa-rotate"></i></span>`;
            
            tbody.innerHTML += `
                <tr>
                    <td>#${c.id}</td>
                    <td><strong>${c.name}</strong></td>
                    <td>${c.instance_id.substring(0,6)}</td>
                    <td>${dateStr}</td>
                    <td>${c.sent_contacts} / ${c.total_contacts} Envios</td>
                    <td>${statusBadge}</td>
                    <td>
                        <button class="btn-action" style="padding: 5px 10px; background: rgba(255,255,255,0.1); border-radius: 4px;" onclick="openEditCampaignModal(${c.id})"><i class="fa-solid fa-pencil"></i></button>
                    </td>
                </tr>
            `;
        });
    } catch (e) {
        console.error(e);
    }
};

let editingCampaignId = null;

window.toggleRecurrenceUI = () => {
    const isChecked = document.getElementById('camp_is_recurring').checked;
    const section = document.getElementById('recurrence_section');
    if (isChecked) section.classList.remove('hidden');
    else section.classList.add('hidden');
};

let addedRecurrenceTimes = [];
window.addRecurrenceTime = () => {
    const timeInput = document.getElementById('camp_time_input').value;
    if (!timeInput) return;
    if (addedRecurrenceTimes.includes(timeInput)) return;
    addedRecurrenceTimes.push(timeInput);
    document.getElementById('camp_time_input').value = '';
    renderRecurrenceTimes();
};

window.removeRecurrenceTime = (time) => {
    addedRecurrenceTimes = addedRecurrenceTimes.filter(t => t !== time);
    renderRecurrenceTimes();
};

window.renderRecurrenceTimes = () => {
    const list = document.getElementById('recurrence_times_list');
    list.innerHTML = '';
    addedRecurrenceTimes.forEach(t => {
        list.innerHTML += `
            <div class="time-chip">
                ${t}
                <button type="button" onclick="removeRecurrenceTime('${t}')"><i class="fa-solid fa-xmark"></i></button>
            </div>
        `;
    });
};

window.openNewCampaignModal = async () => {
    editingCampaignId = null;
    document.getElementById('modal-campaign-title').innerText = 'Criar Mensagem Automática';
    document.getElementById('form-campaign').reset();
    document.getElementById('camp_contacts_box').innerHTML = '<p>Selecione uma instância...</p>';
    
    document.getElementById('camp_is_recurring').checked = false;
    toggleRecurrenceUI();
    addedRecurrenceTimes = [];
    renderRecurrenceTimes();
    document.querySelectorAll('.camp-day-cb').forEach(cb => cb.checked = false);
    
    // Popular instâncias
    const select = document.getElementById('camp_instance');
    select.innerHTML = '<option value="">-- Escolha uma Instância --</option>';
    try {
        const res = await fetch(`${API_BASE}/api/instances`);
        const insts = await res.json();
        insts.forEach(i => {
            select.innerHTML += `<option value="${i.id}">${i.id}</option>`;
        });
    } catch (e) {}
    
    document.getElementById('modal-campaign').classList.remove('hidden');
};

window.openEditCampaignModal = async (id) => {
    editingCampaignId = id;
    const camp = allCampaigns.find(c => c.id === id);
    if (!camp) return;

    document.getElementById('modal-campaign-title').innerText = 'Editar Mensagem Automática';
    document.getElementById('form-campaign').reset();
    
    // Popular instâncias
    const select = document.getElementById('camp_instance');
    select.innerHTML = '<option value="">-- Escolha uma Instância --</option>';
    try {
        const res = await fetch(`${API_BASE}/api/instances`);
        const insts = await res.json();
        insts.forEach(i => {
            select.innerHTML += `<option value="${i.id}">${i.id}</option>`;
        });
    } catch (e) {}
    
    document.getElementById('camp_instance').value = camp.instance_id;
    document.getElementById('camp_name').value = camp.name;
    document.getElementById('camp_message').value = camp.message;
    document.getElementById('camp_datetime').value = camp.scheduled_at;
    
    document.getElementById('camp_is_recurring').checked = camp.is_recurring === 1;
    toggleRecurrenceUI();
    
    document.querySelectorAll('.camp-day-cb').forEach(cb => {
        cb.checked = (camp.recurrence_days || []).includes(parseInt(cb.value));
    });
    
    addedRecurrenceTimes = [...(camp.recurrence_times || [])];
    renderRecurrenceTimes();
    
    await window.loadInstanceContactsForCampaign(camp.instance_id);
    
    try {
        const resC = await fetch(`${API_BASE}/api/campaigns/${id}/contacts`);
        const selectedContacts = await resC.json();
        document.querySelectorAll('.camp-contact-cb').forEach(cb => {
            cb.checked = selectedContacts.includes(cb.value);
        });
    } catch (e) {
        console.error("Erro ao buscar contatos da campanha", e);
    }
    
    document.getElementById('modal-campaign').classList.remove('hidden');
};

let loadedSavedContacts = [];
window.loadInstanceContactsForCampaign = async (instanceId) => {
    const box = document.getElementById('camp_contacts_box');
    if (!instanceId) { box.innerHTML = '<p>Selecione uma instância...</p>'; return; }
    
    box.innerHTML = '<p>Carregando...</p>';
    try {
        const res = await fetch(`${API_BASE}/api/instances/${instanceId}/contacts`);
        loadedSavedContacts = await res.json();
        
        if (loadedSavedContacts.length === 0) {
            box.innerHTML = `<p style="color:var(--orange)">Nenhum contato salvo no banco para esta instância. Vá em Instâncias > Gerenciar e Importe contatos.</p>`;
            return;
        }
        
        box.innerHTML = '';
        loadedSavedContacts.forEach(c => {
            box.innerHTML += `
                <label style="display:flex; align-items:center; gap:10px; margin-bottom:8px; cursor:pointer; padding: 5px; border-radius: 4px; transition: background 0.2s;" onmouseover="this.style.background='rgba(255,255,255,0.05)'" onmouseout="this.style.background='transparent'">
                    <input type="checkbox" class="camp-contact-cb" value="${c.number}" style="width: 16px; height: 16px; accent-color: var(--primary); cursor:pointer; flex-shrink: 0; margin: 0;"> 
                    <div style="display:flex; flex-direction:column; align-items:flex-start; text-align: left;">
                        <span style="color:#fff; font-weight:500; font-size:0.9rem;">${c.name}</span>
                        <small style="color:var(--text-muted); font-size:0.8rem;">${formatWhatsAppNumber(c.number)}</small>
                    </div>
                </label>
            `;
        });
    } catch (e) {
        box.innerHTML = 'Erro ao carregar';
    }
};

window.selectAllContactsCampaign = () => {
    document.querySelectorAll('.camp-contact-cb').forEach(cb => cb.checked = true);
};

document.getElementById('form-campaign').addEventListener('submit', async (e) => {
    e.preventDefault();
    const btn = document.getElementById('btn-save-camp');
    
    const selected = Array.from(document.querySelectorAll('.camp-contact-cb:checked')).map(cb => cb.value);
    if (selected.length === 0) return alert('Selecione contatos!');
    
    const isRecurring = document.getElementById('camp_is_recurring').checked;
    const recurrenceDays = Array.from(document.querySelectorAll('.camp-day-cb:checked')).map(cb => parseInt(cb.value));
    
    if (isRecurring && (recurrenceDays.length === 0 || addedRecurrenceTimes.length === 0)) {
        return alert('Se a campanha é recorrente, selecione pelo menos um dia da semana e adicione um horário.');
    }

    const payload = {
        instanceId: document.getElementById('camp_instance').value,
        name: document.getElementById('camp_name').value,
        message: document.getElementById('camp_message').value,
        scheduledAt: document.getElementById('camp_datetime').value,
        contacts: selected,
        recurrence: {
            is_recurring: isRecurring,
            days: recurrenceDays,
            times: addedRecurrenceTimes
        }
    };
    
    btn.disabled = true;
    btn.textContent = editingCampaignId ? 'Salvando...' : 'Agendando...';
    
    try {
        let res;
        if (editingCampaignId) {
            res = await fetch(`${API_BASE}/api/campaigns/${editingCampaignId}`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload)
            });
        } else {
            res = await fetch(`${API_BASE}/api/campaigns`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload)
            });
        }
        if (!res.ok) throw new Error(await res.text());
        alert(editingCampaignId ? 'Campanha Atualizada!' : 'Campanha Agendada com Sucesso!');
        closeModal('modal-campaign');
        fetchCampaigns();
    } catch (e) {
        alert(e.message);
    } finally {
        btn.disabled = false;
        btn.textContent = 'Agendar Disparo';
    }
});

// ==========================
// PROJETOS (API)
// ==========================
let allProjects = [];
let editingProjectId = null;

window.fetchProjects = async () => {
    try {
        const res = await fetch(`${API_BASE}/api/projects`);
        allProjects = await res.json();
        
        const tbody = document.getElementById('tbody-projects');
        tbody.innerHTML = '';
        
        allProjects.forEach(p => {
            const truncatedKey = p.api_key.length > 20 
                ? `${p.api_key.substring(0, 13)}...${p.api_key.substring(p.api_key.length - 5)}`
                : p.api_key;
                
            tbody.innerHTML += `
                <tr>
                    <td>#${p.id}</td>
                    <td><strong>${p.name}</strong></td>
                    <td><span class="badge" style="background:var(--primary); color:#fff; font-size:0.8rem; padding:3px 8px; border-radius:4px;">${p.instance_id || 'Não vinculada'}</span></td>
                    <td><a href="${p.website}" target="_blank" style="color:var(--primary); text-decoration:none;">${p.website || '-'}</a></td>
                    <td>
                        <div style="display:flex; align-items:center; gap:10px;">
                            <code style="background:rgba(0,0,0,0.3); padding:4px 8px; border-radius:4px; font-size:0.8rem; color:var(--orange);">${truncatedKey}</code>
                            <button class="btn-action" style="padding:4px 8px; background:rgba(255,255,255,0.1);" onclick="copyToClipboard('${p.api_key}')" title="Copiar Chave"><i class="fa-solid fa-copy"></i></button>
                        </div>
                    </td>
                    <td>${p.created_at}</td>
                    <td>
                        <button class="btn-action" style="padding: 5px 10px; background: rgba(32, 201, 151, 0.2); color: var(--primary); border: none; border-radius: 4px;" onclick="openEditProjectModal(${p.id})" title="Editar"><i class="fa-solid fa-pen-to-square"></i></button>
                    </td>
                </tr>
            `;
        });
    } catch (e) {
        console.error(e);
    }
};

window.openNewProjectModal = async () => {
    editingProjectId = null;
    document.getElementById('modal-project-title').innerText = 'Criar Novo Projeto (Chave API)';
    document.getElementById('edit-project-options').classList.add('hidden');
    document.getElementById('btn-save-project').textContent = 'Gerar Chave de API';
    document.getElementById('form-project').reset();
    
    const select = document.getElementById('project_instance');
    select.innerHTML = '<option value="">-- Escolha uma Instância --</option>';
    try {
        const res = await fetch(`${API_BASE}/api/instances`);
        const insts = await res.json();
        insts.forEach(i => {
            select.innerHTML += `<option value="${i.id}">${i.id}</option>`;
        });
    } catch (e) {
        console.error("Erro ao carregar instâncias para o projeto", e);
    }
    
    document.getElementById('modal-project').classList.remove('hidden');
};

window.openEditProjectModal = async (id) => {
    editingProjectId = id;
    const project = allProjects.find(p => p.id === id);
    if (!project) return;

    document.getElementById('modal-project-title').innerText = 'Editar Projeto (Chave API)';
    document.getElementById('btn-save-project').textContent = 'Salvar Alterações';
    document.getElementById('form-project').reset();
    
    const select = document.getElementById('project_instance');
    select.innerHTML = '<option value="">-- Escolha uma Instância --</option>';
    try {
        const res = await fetch(`${API_BASE}/api/instances`);
        const insts = await res.json();
        insts.forEach(i => {
            select.innerHTML += `<option value="${i.id}">${i.id}</option>`;
        });
    } catch (e) {}
    
    document.getElementById('project_name').value = project.name;
    document.getElementById('project_website').value = project.website || '';
    document.getElementById('project_instance').value = project.instance_id || '';
    
    document.getElementById('edit-project-options').classList.remove('hidden');
    
    document.getElementById('btn-project-view-details').onclick = () => {
        showProjectInstructions(project.instance_id, project.api_key);
    };
    
    document.getElementById('btn-project-delete').onclick = () => {
        deleteProject(project.id);
    };
    
    document.getElementById('modal-project').classList.remove('hidden');
};

window.showProjectInstructions = (instanceId, apiKey) => {
    const origin = window.location.origin;
    const endpoint = `${origin}/api/v1/instances/${instanceId}/send-text`;
    const headers = `Content-Type: application/json\nx-api-key: ${apiKey}`;
    
    document.getElementById('inst-id-placeholder').innerText = instanceId;
    document.getElementById('inst-endpoint-placeholder').innerText = endpoint;
    document.getElementById('inst-headers-placeholder').innerText = headers;
    
    window.lastInstApiKey = apiKey;
    
    document.getElementById('modal-project-instructions').classList.remove('hidden');
};

window.copyHeadersToClipboard = () => {
    const headers = `Content-Type: application/json\nx-api-key: ${window.lastInstApiKey}`;
    copyToClipboard(headers);
};

document.getElementById('form-project').addEventListener('submit', async (e) => {
    e.preventDefault();
    const btn = document.getElementById('btn-save-project');
    const name = document.getElementById('project_name').value;
    const website = document.getElementById('project_website').value;
    const instanceId = document.getElementById('project_instance').value;
    
    btn.disabled = true;
    btn.textContent = editingProjectId ? 'Salvando...' : 'Gerando...';
    
    try {
        let res;
        if (editingProjectId) {
            res = await fetch(`${API_BASE}/api/projects/${editingProjectId}`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ name, website, instanceId })
            });
        } else {
            res = await fetch(`${API_BASE}/api/projects`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ name, website, instanceId })
            });
        }
        
        if (!res.ok) throw new Error(await res.text());
        
        if (editingProjectId) {
            showToast('Projeto atualizado com sucesso!', 'success');
            closeModal('modal-project');
            fetchProjects();
        } else {
            const data = await res.json();
            showToast('Projeto criado e Chave de API gerada!', 'success');
            closeModal('modal-project');
            fetchProjects();
            
            setTimeout(() => {
                showProjectInstructions(data.project.instance_id, data.project.api_key);
            }, 500);
        }
    } catch (e) {
        alert(e.message);
    } finally {
        btn.disabled = false;
        btn.textContent = editingProjectId ? 'Salvar Alterações' : 'Gerar Chave de API';
    }
});

window.deleteProject = async (id) => {
    if (!confirm('Tem certeza que deseja apagar este projeto e sua Chave de API? Todos os sistemas que usam esta chave pararão de funcionar!')) return;
    
    try {
        const res = await fetch(`${API_BASE}/api/projects/${id}`, { method: 'DELETE' });
        if (!res.ok) throw new Error('Falha ao deletar');
        showToast('Projeto deletado!', 'success');
        closeModal('modal-project');
        fetchProjects();
    } catch (e) {
        alert(e.message);
    }
};

window.copyToClipboard = (text) => {
    navigator.clipboard.writeText(text).then(() => {
        showToast('Chave de API copiada!', 'success');
    }).catch(err => {
        alert('Erro ao copiar: ' + err);
    });
};

// Update fetch instances poll and campaigns poll
setInterval(() => {
    if (document.getElementById('view-instances').classList.contains('active')) fetchInstances();
    if (document.getElementById('view-campaigns').classList.contains('active')) fetchCampaigns();
    if (document.getElementById('view-projects').classList.contains('active')) fetchProjects();
}, 3000);

// Initialize Navigation Event Listeners
document.querySelectorAll('.nav-item').forEach(el => {
    el.addEventListener('click', (e) => {
        e.preventDefault();
        const target = el.getAttribute('data-target');
        if (target) {
            document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
            el.classList.add('active');
            switchView(target);
            if (target === 'view-campaigns') fetchCampaigns();
            if (target === 'view-projects') fetchProjects();
        }
    });
});

// ==========================
// TELA DE INSTÂNCIAS
// ==========================
async function fetchInstances() {
    try {
        const res = await fetch(`${API_BASE}/api/instances`);
        const instances = await res.json();
        
        let connected = 0;
        let disconnected = 0;
        
        tbodyInstances.innerHTML = '';
        instances.forEach(inst => {
            if (inst.status === 'CONNECTED') connected++;
            else disconnected++;

            const statusClass = inst.status === 'CONNECTED' ? 'conn' : 'disc';
            const statusLabel = inst.status === 'CONNECTED' ? 'Conectada' : (inst.status === 'QR_READY' ? 'Aguardando QR' : 'Desconectada');

            const tr = document.createElement('tr');
            tr.innerHTML = `
                <td><strong>Instância ${inst.id.substring(0,4)}</strong></td>
                <td><span class="badge-tipo">Local</span></td>
                <td><span class="status-text ${statusClass}">${statusLabel}</span></td>
                <td class="id-text">${inst.id}</td>
                <td class="id-text" style="font-size:0.7rem;">${inst.token}</td>
                <td>${inst.createdAt}</td>
                <td>
                    <button class="btn-manage" title="Gerenciar" onclick="openInstance('${inst.id}')"><i class="fa-solid fa-gear"></i></button>
                    <button class="btn-manage" style="background:rgba(243, 156, 18, 0.2); color:var(--orange);" title="Editar Webhooks" onclick="editInstance('${inst.id}')"><i class="fa-solid fa-pen"></i></button>
                    <button class="btn-delete" title="Excluir" onclick="deleteInstance('${inst.id}')"><i class="fa-solid fa-trash"></i></button>
                </td>
            `;
            tbodyInstances.appendChild(tr);
        });

        lblTotalInst.textContent = instances.length;
        lblTotalConn.textContent = connected;
        lblTotalDisc.textContent = disconnected;

    } catch (error) {
        console.error("Erro ao buscar instâncias:", error);
    }
}

window.editInstance = async (id) => {
    try {
        const res = await fetch(`${API_BASE}/api/instances/${id}/config`);
        if (!res.ok) throw new Error('Falha ao carregar dados');
        const data = await res.json();
        
        document.getElementById('cfg_id').value = data.id;
        document.getElementById('cfg_id').readOnly = true;
        document.getElementById('cfg_token').value = data.token;
        
        document.getElementById('cfg_wh_in').value = data.wh_message_in || '';
        document.getElementById('cfg_wh_out').value = data.wh_message_out || '';
        document.getElementById('cfg_wh_conn').value = data.wh_connect || '';
        document.getElementById('cfg_wh_disc').value = data.wh_disconnect || '';
        document.getElementById('cfg_wh_stat').value = data.wh_status || '';
        document.getElementById('cfg_wh_pres').value = data.wh_presence || '';
        
        document.getElementById('cfg_notify_own').checked = data.notify_own_msg;
        document.getElementById('cfg_opt_reject').checked = data.opt_reject_call;
        document.getElementById('cfg_opt_read').checked = data.opt_read_msg;
        document.getElementById('cfg_opt_read_status').checked = data.opt_read_status;
        document.getElementById('cfg_opt_no_queue').checked = data.opt_disable_queue;
        
        switchView('view-form');
    } catch (e) {
        alert(e.message);
    }
};

// Formulário
const formSettings = document.getElementById('instance-settings-form');
const btnGenToken = document.getElementById('btn-gen-token');
const inputToken = document.getElementById('cfg_token');

btnAddInstance.addEventListener('click', () => {
    formSettings.reset();
    inputToken.value = '';
    document.getElementById('cfg_id').readOnly = false;
    switchView('view-form');
});

btnGenToken.addEventListener('click', () => {
    inputToken.value = Math.random().toString(36).substring(2, 15) + Math.random().toString(36).substring(2, 15);
});

formSettings.addEventListener('submit', async (e) => {
    e.preventDefault();
    const btnSave = document.getElementById('btn-save-instance');
    btnSave.textContent = 'Salvando...';
    btnSave.disabled = true;

    const payload = {
        id: document.getElementById('cfg_id').value,
        token: inputToken.value,
        wh_message_in: document.getElementById('cfg_wh_in').value,
        wh_message_out: document.getElementById('cfg_wh_out').value,
        wh_connect: document.getElementById('cfg_wh_conn').value,
        wh_disconnect: document.getElementById('cfg_wh_disc').value,
        wh_status: document.getElementById('cfg_wh_stat').value,
        wh_presence: document.getElementById('cfg_wh_pres').value,
        notify_own_msg: document.getElementById('cfg_notify_own').checked,
        opt_reject_call: document.getElementById('cfg_opt_reject').checked,
        opt_read_msg: document.getElementById('cfg_opt_read').checked,
        opt_read_status: document.getElementById('cfg_opt_read_status').checked,
        opt_disable_queue: document.getElementById('cfg_opt_no_queue').checked
    };

    try {
        await fetch(`${API_BASE}/api/instances`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });
        switchView('view-instances');
    } catch (error) {
        alert('Erro ao salvar: ' + error.message);
    } finally {
        btnSave.textContent = 'Salvar';
        btnSave.disabled = false;
    }
});

window.deleteInstance = async (id) => {
    if (confirm(`Excluir instância ${id} e todos os seus dados de sessão?`)) {
        await fetch(`${API_BASE}/api/instances/${id}`, { method: 'DELETE' });
        fetchInstances();
    }
};

window.openInstance = (id) => {
    activeInstanceId = id;
    spanInstanceId.textContent = id;
    document.querySelector('[data-target="view-dashboard"]').click();
};

// ==========================
// TELA DE DASHBOARD DA INSTÂNCIA
// ==========================
async function fetchInstanceData() {
    if (!activeInstanceId) {
        updateDashboardUI('NO_INSTANCE', null);
        return;
    }

    try {
        const [resStatus, resMsgs] = await Promise.all([
            fetch(`${API_BASE}/api/instances/${activeInstanceId}/status`),
            fetch(`${API_BASE}/api/instances/${activeInstanceId}/messages`)
        ]);

        if (resStatus.ok) {
            const dataStatus = await resStatus.json();
            updateDashboardUI(dataStatus.status, dataStatus.qrCode);
        }

        if (resMsgs.ok) {
            const dataMsgs = await resMsgs.json();
            renderMessages(dataMsgs);
        }
    } catch (error) {
        console.error("Erro ao atualizar dashboard:", error);
    }
}

function updateDashboardUI(status, qrCodeString) {
    if (status === lastStatus && status !== 'QR_READY') return;
    lastStatus = status;

    elStateStarting.classList.add('hidden');
    elStateQr.classList.add('hidden');
    elStateConnected.classList.add('hidden');

    if (status === 'STARTING') {
        elStateStarting.classList.remove('hidden');
        elStateStarting.innerHTML = '<div class="loader"></div><p style="margin-top: 15px; color: var(--text-muted);">Inicializando...</p>';
    } 
    else if (status === 'NO_INSTANCE') {
        elStateStarting.classList.remove('hidden');
        elStateStarting.innerHTML = '<div style="color:var(--orange); font-size:2rem; margin-bottom:10px;"><i class="fa-solid fa-hand-pointer"></i></div><p style="color:var(--orange)">Nenhuma instância selecionada.</p><p style="font-size:0.8rem; color:var(--text-muted); margin-top:5px;">Vá no menu Instâncias Web e clique em Gerenciar.</p>';
    }
    else if (status === 'DISCONNECTED' || status === 'ERROR') {
        elStateStarting.classList.remove('hidden');
        elStateStarting.innerHTML = '<div style="color:#ef4444; font-size:2rem; margin-bottom:10px;"><i class="fa-solid fa-triangle-exclamation"></i></div><p style="color:#ef4444">Instância Desconectada ou em Erro</p>';
    }
    else if (status === 'QR_READY') {
        elStateQr.classList.remove('hidden');
        if (qrCodeString) {
            elQrBox.innerHTML = '';
            qrcodeObj = new QRCode(elQrBox, {
                text: qrCodeString,
                width: 200, height: 200,
                colorDark : "#000000", colorLight : "#ffffff",
                correctLevel : QRCode.CorrectLevel.H
            });
        }
    }
    else if (status === 'CONNECTED') {
        elStateConnected.classList.remove('hidden');
    }
}

function renderMessages(messages) {
    elLogsContainer.innerHTML = '';
    let countIn = 0, countOut = 0;

    if (messages.length === 0) {
        elLogsContainer.innerHTML = '<p style="color: var(--text-muted); text-align: center; padding: 20px;">Nenhuma mensagem registrada.</p>';
    } else {
        messages.forEach(msg => {
            if (msg.direction === 'IN') countIn++; else countOut++;
            const div = document.createElement('div');
            div.className = `log-item ${msg.direction === 'IN' ? 'in' : 'out'}`;
            const date = new Date(msg.timestamp * 1000).toLocaleTimeString();
            const contact = msg.direction === 'IN' ? msg.from.split('@')[0] : msg.to.split('@')[0];
            const icon = msg.direction === 'IN' ? '<i class="fa-solid fa-arrow-down" style="color:var(--orange)"></i>' : '<i class="fa-solid fa-arrow-up" style="color:var(--primary)"></i>';
            div.innerHTML = `
                <div class="log-header"><span>${icon} ${contact}</span><span>${date}</span></div>
                <div class="log-body">${msg.hasMedia ? '<em>[Mídia]</em> ' : ''}${msg.body}</div>
            `;
            elLogsContainer.appendChild(div);
        });
    }

    elCountIn.textContent = countIn;
    elCountOut.textContent = countOut;
}

formSend.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (!activeInstanceId) return;

    const btn = document.getElementById('btn-send');
    const number = document.getElementById('numero').value;
    const message = document.getElementById('mensagem').value;

    btn.textContent = 'Enviando...';
    btn.disabled = true;
    feedbackMsg.textContent = '';

    try {
        const res = await fetch(`${API_BASE}/api/instances/${activeInstanceId}/send-message`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ number, message })
        });
        
        const data = await res.json();
        if (data.success) {
            formSend.reset();
            feedbackMsg.style.color = 'var(--primary)';
            feedbackMsg.textContent = '✅ Mensagem enviada!';
            fetchInstanceData();
        } else {
            throw new Error(data.error);
        }
    } catch (error) {
        feedbackMsg.style.color = '#ef4444';
        feedbackMsg.textContent = `❌ Erro: ${error.message}`;
    } finally {
        btn.textContent = 'Enviar';
        btn.disabled = false;
        setTimeout(() => { feedbackMsg.textContent = ''; }, 4000);
    }
});

btnDisconnectInstance.addEventListener('click', async (e) => {
    e.preventDefault();
    if (!activeInstanceId) return;
    if(confirm('Tem certeza que deseja desconectar o WhatsApp desta instância?')) {
        await fetch(`${API_BASE}/api/instances/${activeInstanceId}/disconnect`, { method: 'POST' });
        fetchInstanceData();
    }
});

// ==========================================
// PAINEL DE CHAT INTEGRADO (LÓGICA FRONTEND)
// ==========================================

let chatList = [];
let currentChatFilter = 'all'; // 'all' (respondidas), 'unread' (não respondidas)
let chatSearchQuery = '';
let activeChatId = null;
let sseSource = null;

// Elementos da interface do Chat
const elChatNoInstance = document.getElementById('chat-no-instance');
const elChatOffline = document.getElementById('chat-offline');
const elChatMainContainer = document.getElementById('chat-main-container');
const elChatsList = document.getElementById('chats-list');
const elChatMessagesContainer = document.getElementById('chat-messages-container');
const elChatWindow = document.getElementById('chat-window');
const elChatAreaPlaceholder = document.getElementById('chat-area-placeholder');

const elChatActiveAvatar = document.getElementById('chat-active-avatar');
const elChatActiveName = document.getElementById('chat-active-name');
const elChatActiveDetails = document.getElementById('chat-active-details');

const elChatTextInput = document.getElementById('chat-text-input');
const elBtnSendChat = document.getElementById('btn-send-chat');
const elBtnAttach = document.getElementById('btn-attach');
const elChatFileInput = document.getElementById('chat-file-input');
const elChatSearchInput = document.getElementById('chat-search-input');

const elFilterAllChats = document.getElementById('filter-all-chats');
const elFilterUnreadChats = document.getElementById('filter-unread-chats');
const elUnreadChatsCount = document.getElementById('unread-chats-count');

const elBtnNewChat = document.getElementById('btn-new-chat');
const elModalNewChat = document.getElementById('modal-new-chat');
const elCloseModalNewChat = document.getElementById('close-modal-new-chat');
const elBtnCancelNewChat = document.getElementById('btn-cancel-new-chat');
const elBtnConfirmNewChat = document.getElementById('btn-confirm-new-chat');
const elNewChatNumber = document.getElementById('new-chat-number');
const elNewChatError = document.getElementById('new-chat-error');

// Iniciar a aba do Chat
async function initChatView() {
    closeChatSSE();
    
    if (!activeInstanceId) {
        elChatNoInstance.classList.remove('hidden');
        elChatOffline.classList.add('hidden');
        elChatMainContainer.classList.add('hidden');
        return;
    }

    try {
        const resStatus = await fetch(`${API_BASE}/api/instances/${activeInstanceId}/status`);
        if (!resStatus.ok) throw new Error();
        
        const dataStatus = await resStatus.json();
        if (dataStatus.status !== 'CONNECTED') {
            elChatNoInstance.classList.add('hidden');
            elChatOffline.classList.remove('hidden');
            elChatMainContainer.classList.add('hidden');
            return;
        }

        elChatNoInstance.classList.add('hidden');
        elChatOffline.classList.add('hidden');
        elChatMainContainer.classList.remove('hidden');

        await fetchChats();
        setupChatSSE();
    } catch (e) {
        elChatNoInstance.classList.add('hidden');
        elChatOffline.classList.remove('hidden');
        elChatMainContainer.classList.add('hidden');
    }
}

// Buscar conversas da API
async function fetchChats() {
    try {
        const res = await fetch(`${API_BASE}/api/instances/${activeInstanceId}/chats`);
        if (res.ok) {
            chatList = await res.json();
            renderChatsList();
        }
    } catch (error) {
        console.error("Erro ao carregar conversas:", error);
    }
}

// Iniciar conexão Server-Sent Events (SSE) para tempo real
function setupChatSSE() {
    closeChatSSE();
    
    sseSource = new EventSource(`${API_BASE}/api/instances/${activeInstanceId}/chat-sse`);
    
    sseSource.onmessage = (event) => {
        try {
            const data = JSON.parse(event.data);
            
            if (data.type === 'message') {
                handleIncomingSSEMessage(data.message);
            } else if (data.type === 'disconnected') {
                initChatView();
            } else if (data.type === 'ready') {
                initChatView();
            }
        } catch (e) {
            console.error("Erro ao processar SSE:", e);
        }
    };

    sseSource.onerror = () => {
        console.log("Erro no EventSource SSE. Tentando reconectar...");
    };
}

function closeChatSSE() {
    if (sseSource) {
        sseSource.close();
        sseSource = null;
    }
}

// Comparar dois JIDs desconsiderando sufixos (ex: @c.us vs @lid)
function isSameJID(id1, id2) {
    if (!id1 || !id2) return false;
    return id1.split('@')[0] === id2.split('@')[0];
}

// Tratar mensagem recebida via SSE (Tempo Real)
function handleIncomingSSEMessage(msg) {
    const chatId = msg.fromMe ? msg.to : msg.from;
    
    let chat = chatList.find(c => isSameJID(c.id, chatId));
    if (!chat) {
        chat = {
            id: chatId,
            name: chatId.split('@')[0],
            isGroup: chatId.includes('@g.us'),
            unreadCount: msg.fromMe ? 0 : 1,
            timestamp: msg.timestamp,
            lastMessage: {
                body: msg.body,
                fromMe: msg.fromMe,
                timestamp: msg.timestamp,
                type: msg.type
            }
        };
        chatList.unshift(chat);
    } else {
        chat.timestamp = msg.timestamp;
        chat.lastMessage = {
            body: msg.body,
            fromMe: msg.fromMe,
            timestamp: msg.timestamp,
            type: msg.type
        };
        if (!msg.fromMe && !isSameJID(activeChatId, chatId)) {
            chat.unreadCount++;
        }
        
        chatList = [chat, ...chatList.filter(c => !isSameJID(c.id, chatId))];
    }

    renderChatsList();

    if (isSameJID(activeChatId, chatId)) {
        // Se a mensagem já existe no DOM (ex: quando foi deletada/revogada em outro aparelho), atualiza seu estado
        const existingMsgDiv = elChatMessagesContainer.querySelector(`[data-msg-id="${msg.id}"]`);
        if (existingMsgDiv) {
            if (msg.type === 'revoked') {
                const date = new Date(msg.timestamp * 1000);
                const timeStr = date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
                let htmlContent = '';
                if (!msg.fromMe && activeChatId.includes('@g.us') && msg.sender) {
                    const senderLabel = msg.senderName || msg.sender.split('@')[0];
                    htmlContent += `<span class="msg-sender">${escapeHTML(senderLabel)}</span>`;
                }
                htmlContent += `<p style="font-style: italic; opacity: 0.8; display: flex; align-items: center; gap: 6px;">
                    <i class="fa-solid fa-ban" style="font-size: 0.9rem;"></i>
                    Mensagem apagada
                </p>`;
                htmlContent += `<span class="msg-time">${timeStr}</span>`;
                existingMsgDiv.innerHTML = htmlContent;
                
                // Remove o botão de apagar se for nossa
                const delBtn = existingMsgDiv.querySelector('.msg-delete-btn');
                if (delBtn) delBtn.remove();
            }
            return;
        }

        appendMessageBubble({
            id: msg.id,
            body: msg.body,
            type: msg.type,
            timestamp: msg.timestamp,
            fromMe: msg.fromMe,
            sender: msg.sender,
            senderName: msg.senderName,
            hasMedia: msg.hasMedia,
            mimetype: msg.mimetype,
            size: msg.size
        });
        
        fetch(`${API_BASE}/api/instances/${activeInstanceId}/chats/${chatId}/seen`, { method: 'POST' });
        chat.unreadCount = 0;
        renderChatsList();
    }
}

// Renderizar lista de chats com filtros de Marlon Souza
function renderChatsList() {
    elChatsList.innerHTML = '';
    
    const filtered = chatList.filter(chat => {
        const nameMatches = chat.name.toLowerCase().includes(chatSearchQuery.toLowerCase()) || 
                            chat.id.includes(chatSearchQuery);
        if (!nameMatches) return false;

        const lastMsgFromMe = chat.lastMessage ? chat.lastMessage.fromMe : false;
        const hasUnread = chat.unreadCount > 0;

        if (currentChatFilter === 'unread') {
            // Não lidas = não respondidas (tem mensagens não lidas OU o último envio não foi nosso)
            return hasUnread || !lastMsgFromMe;
        } else {
            // Tudo = respondidas (não tem mensagens não lidas E o último envio foi nosso)
            return !hasUnread && lastMsgFromMe;
        }
    });

    const unansweredCount = chatList.filter(chat => {
        const lastMsgFromMe = chat.lastMessage ? chat.lastMessage.fromMe : false;
        const hasUnread = chat.unreadCount > 0;
        return hasUnread || !lastMsgFromMe;
    }).length;

    elUnreadChatsCount.textContent = unansweredCount;

    if (filtered.length === 0) {
        elChatsList.innerHTML = '<p style="text-align:center; color:var(--text-muted); margin-top:20px; font-size:0.85rem;">Nenhuma conversa nesta lista.</p>';
        return;
    }

    filtered.forEach(chat => {
        const div = document.createElement('div');
        div.className = `chat-item ${isSameJID(activeChatId, chat.id) ? 'active' : ''}`;
        
        let timeStr = '';
        if (chat.timestamp) {
            const date = new Date(chat.timestamp * 1000);
            timeStr = date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
        }

        let bodyPreview = '';
        if (chat.lastMessage) {
            if (chat.lastMessage.type === 'chat') {
                bodyPreview = chat.lastMessage.body;
            } else {
                bodyPreview = `📷 [Arquivo / Mídia]`;
            }
        }

        const unreadBadge = chat.unreadCount > 0 
            ? `<span class="chat-unread-badge">${chat.unreadCount}</span>` 
            : '';

        div.innerHTML = `
            <div class="chat-avatar-img" style="background-image: url('${API_BASE}/api/instances/${activeInstanceId}/chats/${chat.id}/avatar')"></div>
            <div class="chat-info">
                <div class="chat-meta">
                    <span class="chat-name">${escapeHTML(chat.name)}</span>
                    <span class="chat-time">${timeStr}</span>
                </div>
                <div class="chat-last-msg">
                    <span class="chat-msg-text">${chat.lastMessage?.fromMe ? '<i class="fa-solid fa-check-double" style="color:var(--primary); font-size:0.75rem; margin-right:3px;"></i>' : ''}${escapeHTML(bodyPreview)}</span>
                    ${unreadBadge}
                </div>
            </div>
        `;
        
        div.addEventListener('click', () => selectChat(chat));
        elChatsList.appendChild(div);
    });
}

// Selecionar e abrir um chat específico
async function selectChat(chat) {
    activeChatId = chat.id;
    
    chat.unreadCount = 0;
    renderChatsList();

    // Adiciona classe de selecionado no mobile para abrir a janela de mensagens
    elChatMainContainer.classList.add('chat-selected');

    elChatAreaPlaceholder.classList.add('hidden');
    elChatWindow.classList.remove('hidden');
    
    elChatActiveName.textContent = chat.name;
    elChatActiveDetails.textContent = chat.isGroup ? 'Grupo do WhatsApp' : chat.id.split('@')[0];
    elChatActiveAvatar.style.backgroundImage = `url('${API_BASE}/api/instances/${activeInstanceId}/chats/${chat.id}/avatar')`;

    fetch(`${API_BASE}/api/instances/${activeInstanceId}/chats/${chat.id}/seen`, { method: 'POST' });

    elChatMessagesContainer.innerHTML = '<div style="display:flex; justify-content:center; padding:20px;"><div class="loader"></div></div>';
    
    try {
        const res = await fetch(`${API_BASE}/api/instances/${activeInstanceId}/chats/${chat.id}/messages`);
        if (res.ok) {
            const messages = await res.json();
            elChatMessagesContainer.innerHTML = '';
            
            if (messages.length === 0) {
                elChatMessagesContainer.innerHTML = '<p style="text-align:center; color:var(--text-muted); padding:20px;">Nenhuma mensagem nesta conversa.</p>';
            } else {
                messages.forEach(msg => appendMessageBubble(msg));
            }
            scrollToBottom();
        }
    } catch (error) {
        console.error("Erro ao carregar mensagens:", error);
        elChatMessagesContainer.innerHTML = '<p style="text-align:center; color:#ef4444; padding:20px;">Erro ao carregar histórico de mensagens.</p>';
    }
}

// Renderizar e anexar bolha de mensagem no histórico
function appendMessageBubble(msg) {
    const div = document.createElement('div');
    div.className = `msg-bubble ${msg.fromMe ? 'sent' : 'received'}`;
    div.setAttribute('data-msg-id', msg.id);
    
    const date = new Date(msg.timestamp * 1000);
    const timeStr = date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    
    let htmlContent = '';
    
    // Caso a mensagem tenha sido apagada/revogada
    if (msg.type === 'revoked') {
        if (!msg.fromMe && activeChatId.includes('@g.us') && msg.sender) {
            const senderLabel = msg.senderName || msg.sender.split('@')[0];
            htmlContent += `<span class="msg-sender">${escapeHTML(senderLabel)}</span>`;
        }
        htmlContent += `<p style="font-style: italic; opacity: 0.8; display: flex; align-items: center; gap: 6px;">
            <i class="fa-solid fa-ban" style="font-size: 0.9rem;"></i>
            Mensagem apagada
        </p>`;
        htmlContent += `<span class="msg-time">${timeStr}</span>`;
        div.innerHTML = htmlContent;
        elChatMessagesContainer.appendChild(div);
        scrollToBottom();
        return;
    }
    
    if (!msg.fromMe && activeChatId.includes('@g.us') && msg.sender) {
        const senderLabel = msg.senderName || msg.sender.split('@')[0];
        htmlContent += `<span class="msg-sender">${escapeHTML(senderLabel)}</span>`;
    }
    
    if (msg.fromMe) {
        htmlContent += `<button class="msg-delete-btn" onclick="deleteChatMessage('${msg.id}')" title="Apagar para todos"><i class="fa-solid fa-trash-can"></i></button>`;
    }
    
    if (msg.hasMedia) {
        const maxSize = 150 * 1024 * 1024;
        if (msg.size && msg.size > maxSize) {
            htmlContent += `
                <p style="font-style: italic; color: var(--text-muted); margin-bottom: 5px;">
                    [Arquivo com mais de 150MB. Para visualizar ou baixar esta mídia, utilize o aplicativo oficial do WhatsApp.]
                </p>
            `;
        } else {
            const mediaUrl = `${API_BASE}/api/instances/${activeInstanceId}/messages/${msg.id}/media?chatId=${activeChatId}`;
            const mt = msg.mimetype || '';
            
            if (mt.startsWith('image/')) {
                htmlContent += `
                    <div class="msg-media-container">
                        <img src="${mediaUrl}" class="msg-media-img" onclick="window.open('${mediaUrl}')" alt="Imagem">
                    </div>
                `;
            } else if (mt.startsWith('video/')) {
                htmlContent += `
                    <div class="msg-media-container">
                        <video src="${mediaUrl}" controls class="msg-media-video"></video>
                    </div>
                `;
            } else if (mt.startsWith('audio/')) {
                htmlContent += `
                    <div class="msg-media-container">
                        <audio src="${mediaUrl}" controls class="msg-media-audio"></audio>
                    </div>
                `;
            } else {
                const filename = msg.body || 'arquivo';
                htmlContent += `
                    <div class="msg-file-download">
                        <i class="fa-solid fa-file-arrow-down"></i>
                        <div class="msg-file-info">
                            <div class="msg-file-name" title="${escapeHTML(filename)}">${escapeHTML(filename)}</div>
                        </div>
                        <a href="${mediaUrl}" target="_blank" download="${escapeHTML(filename)}" class="msg-file-btn"><i class="fa-solid fa-arrow-down-long"></i></a>
                    </div>
                `;
            }
        }
    }
    
    if (msg.body && (!msg.hasMedia || msg.mimetype?.startsWith('audio/')) && !(msg.size && msg.size > 150 * 1024 * 1024)) {
        htmlContent += `<p>${escapeHTML(msg.body).replace(/\n/g, '<br>')}</p>`;
    }
    
    htmlContent += `<span class="msg-time">${timeStr}</span>`;
    div.innerHTML = htmlContent;
    
    elChatMessagesContainer.appendChild(div);
    scrollToBottom();
}

function scrollToBottom() {
    elChatMessagesContainer.scrollTop = elChatMessagesContainer.scrollHeight;
}

// Enviar Mensagem de Texto
async function sendChatTextMessage() {
    const text = elChatTextInput.value.trim();
    if (!text || !activeChatId) return;
    
    elChatTextInput.value = '';
    
    try {
        const res = await fetch(`${API_BASE}/api/instances/${activeInstanceId}/send-message`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ number: activeChatId, message: text })
        });
        
        if (!res.ok) {
            const data = await res.json().catch(() => ({}));
            throw new Error(data.details || data.error || 'Erro desconhecido');
        }
    } catch (e) {
        console.error('Erro ao enviar mensagem:', e);
        showToast('Erro', `Não foi possível enviar a mensagem: ${e.message}`, 'error');
    }
}

// Apagar mensagem para todos (Revogar)
async function deleteChatMessage(messageId) {
    if (!confirm('Deseja apagar esta mensagem para todos?')) return;
    
    try {
        const res = await fetch(`${API_BASE}/api/instances/${activeInstanceId}/chats/${activeChatId}/messages/${messageId}`, {
            method: 'DELETE'
        });
        
        if (!res.ok) {
            const data = await res.json().catch(() => ({}));
            throw new Error(data.details || data.error || 'Erro ao apagar mensagem');
        }
        
        showToast('Sucesso', 'Mensagem apagada para todos.', 'success');
        
        // Atualiza o balão de mensagem no DOM localmente
        const existingMsgDiv = elChatMessagesContainer.querySelector(`[data-msg-id="${messageId}"]`);
        if (existingMsgDiv) {
            const timeStr = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
            existingMsgDiv.innerHTML = `
                <p style="font-style: italic; opacity: 0.8; display: flex; align-items: center; gap: 6px;">
                    <i class="fa-solid fa-ban" style="font-size: 0.9rem;"></i>
                    Mensagem apagada
                </p>
                <span class="msg-time">${timeStr}</span>
            `;
            // Remove o botão de apagar
            const delBtn = existingMsgDiv.querySelector('.msg-delete-btn');
            if (delBtn) delBtn.remove();
        }
    } catch (error) {
        console.error('Erro ao apagar mensagem:', error);
        showToast('Erro', `Não foi possível apagar a mensagem: ${error.message}`, 'error');
    }
}

// Tratar Seleção de Arquivo e validação do limite de 150MB
async function handleChatFileSelect(e) {
    const file = e.target.files[0];
    if (!file || !activeChatId) return;
    
    const maxSize = 150 * 1024 * 1024;
    if (file.size > maxSize) {
        const timeStr = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
        const div = document.createElement('div');
        div.className = 'msg-bubble received';
        div.style.alignSelf = 'center';
        div.style.background = 'rgba(239, 68, 68, 0.1)';
        div.style.border = '1px solid rgba(239, 68, 68, 0.2)';
        div.innerHTML = `
            <p style="font-style: italic; color: #ef4444; margin-bottom: 5px;">
                O arquivo "${escapeHTML(file.name)}" (${(file.size / (1024 * 1024)).toFixed(1)} MB) é maior que 150MB e não pôde ser enviado por aqui. Por favor, utilize o aplicativo oficial do WhatsApp para enviar mídias deste tamanho.
            </p>
            <span class="msg-time">${timeStr}</span>
        `;
        elChatMessagesContainer.appendChild(div);
        scrollToBottom();
        
        elChatFileInput.value = '';
        return;
    }
    
    showToast('Enviando', 'Processando arquivo de mídia...', 'success');
    
    const reader = new FileReader();
    reader.onload = async () => {
        const base64Data = reader.result.split(',')[1];
        
        try {
            const res = await fetch(`${API_BASE}/api/instances/${activeInstanceId}/send-media`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    number: activeChatId,
                    base64: base64Data,
                    mimetype: file.type,
                    filename: file.name,
                    caption: ''
                })
            });
            
            if (!res.ok) {
                const data = await res.json().catch(() => ({}));
                throw new Error(data.details || data.error || 'Erro desconhecido');
            }
            
            showToast('Sucesso', 'Arquivo enviado com sucesso.', 'success');
        } catch (err) {
            console.error('Erro ao enviar arquivo:', err);
            showToast('Erro', `Falha ao enviar arquivo de mídia: ${err.message}`, 'error');
        } finally {
            elChatFileInput.value = '';
        }
    };
    reader.readAsDataURL(file);
}

// Iniciar Nova Conversa (Modal)
async function startNewChat() {
    const number = elNewChatNumber.value.trim();
    if (!number) return;
    
    elNewChatError.classList.add('hidden');
    elBtnConfirmNewChat.disabled = true;
    elBtnConfirmNewChat.textContent = 'Verificando...';
    
    try {
        const res = await fetch(`${API_BASE}/api/instances/${activeInstanceId}/contacts/${number}/registered`);
        if (!res.ok) throw new Error("Erro na comunicação");
        
        const data = await res.json();
        if (data.isRegistered) {
            elModalNewChat.classList.add('hidden');
            elNewChatNumber.value = '';
            
            const newChat = {
                id: data.formatted,
                name: number,
                isGroup: false,
                unreadCount: 0,
                timestamp: Math.floor(Date.now() / 1000),
                lastMessage: null
            };
            
            if (!chatList.find(c => isSameJID(c.id, data.formatted))) {
                chatList.unshift(newChat);
            }
            
            renderChatsList();
            selectChat(newChat);
        } else {
            elNewChatError.textContent = 'Este número de telefone não possui WhatsApp ativo.';
            elNewChatError.classList.remove('hidden');
        }
    } catch (e) {
        elNewChatError.textContent = 'Erro ao verificar o número de telefone.';
        elNewChatError.classList.remove('hidden');
    } finally {
        elBtnConfirmNewChat.disabled = false;
        elBtnConfirmNewChat.textContent = 'Iniciar Chat';
    }
}

// Configurar Event Listeners do Chat
elFilterAllChats.addEventListener('click', () => {
    currentChatFilter = 'all';
    elFilterAllChats.classList.add('active');
    elFilterUnreadChats.classList.remove('active');
    renderChatsList();
});

elFilterUnreadChats.addEventListener('click', () => {
    currentChatFilter = 'unread';
    elFilterAllChats.classList.remove('active');
    elFilterUnreadChats.classList.add('active');
    renderChatsList();
});

elChatSearchInput.addEventListener('input', (e) => {
    chatSearchQuery = e.target.value;
    renderChatsList();
});

elBtnSendChat.addEventListener('click', sendChatTextMessage);
elChatTextInput.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') sendChatTextMessage();
});

elBtnAttach.addEventListener('click', () => elChatFileInput.click());
elChatFileInput.addEventListener('change', handleChatFileSelect);

// Modal de Nova Conversa
elBtnNewChat.addEventListener('click', () => {
    elNewChatError.classList.add('hidden');
    elModalNewChat.classList.remove('hidden');
    elNewChatNumber.focus();
});

elCloseModalNewChat.addEventListener('click', () => elModalNewChat.classList.add('hidden'));
elBtnCancelNewChat.addEventListener('click', () => elModalNewChat.classList.add('hidden'));
elBtnConfirmNewChat.addEventListener('click', startNewChat);
elNewChatNumber.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') startNewChat();
});

// Botão de voltar no mobile
document.getElementById('btn-chat-back').addEventListener('click', () => {
    activeChatId = null;
    elChatMainContainer.classList.remove('chat-selected');
    renderChatsList();
});

// Helper de escape
function escapeHTML(str) {
    if (!str) return '';
    return str
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#039;");
}

window.closeChatSSE = closeChatSSE;

// Init
switchView('view-instances');
