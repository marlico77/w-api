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
        if (target === 'view-dashboard' && !activeInstanceId) {
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
    
    clearInterval(pollInterval);
    if (viewId === 'view-instances') {
        fetchInstances();
        pollInterval = setInterval(fetchInstances, 3000);
    } else if (viewId === 'view-dashboard') {
        lastStatus = '';
        fetchInstanceData();
        pollInterval = setInterval(fetchInstanceData, 3000);
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
window.fetchProjects = async () => {
    try {
        const res = await fetch(`${API_BASE}/api/projects`);
        const projects = await res.json();
        
        const tbody = document.getElementById('tbody-projects');
        tbody.innerHTML = '';
        
        projects.forEach(p => {
            tbody.innerHTML += `
                <tr>
                    <td>#${p.id}</td>
                    <td><strong>${p.name}</strong></td>
                    <td><a href="${p.website}" target="_blank" style="color:var(--primary); text-decoration:none;">${p.website || '-'}</a></td>
                    <td>
                        <div style="display:flex; align-items:center; gap:10px;">
                            <code style="background:rgba(0,0,0,0.3); padding:4px 8px; border-radius:4px; font-size:0.8rem; color:var(--orange);">${p.api_key}</code>
                            <button class="btn-action" style="padding:4px 8px; background:rgba(255,255,255,0.1);" onclick="copyToClipboard('${p.api_key}')" title="Copiar Chave"><i class="fa-solid fa-copy"></i></button>
                        </div>
                    </td>
                    <td>${p.created_at}</td>
                    <td>
                        <button class="btn-action red-outline" onclick="deleteProject(${p.id})"><i class="fa-solid fa-trash"></i></button>
                    </td>
                </tr>
            `;
        });
    } catch (e) {
        console.error(e);
    }
};

window.openNewProjectModal = () => {
    document.getElementById('form-project').reset();
    document.getElementById('modal-project').classList.remove('hidden');
};

document.getElementById('form-project').addEventListener('submit', async (e) => {
    e.preventDefault();
    const btn = document.getElementById('btn-save-project');
    const name = document.getElementById('project_name').value;
    const website = document.getElementById('project_website').value;
    
    btn.disabled = true;
    btn.textContent = 'Gerando...';
    
    try {
        const res = await fetch(`${API_BASE}/api/projects`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ name, website })
        });
        if (!res.ok) throw new Error(await res.text());
        
        showToast('Projeto criado e Chave de API gerada!', 'success');
        closeModal('modal-project');
        fetchProjects();
    } catch (e) {
        alert(e.message);
    } finally {
        btn.disabled = false;
        btn.textContent = 'Gerar Chave de API';
    }
});

window.deleteProject = async (id) => {
    if (!confirm('Tem certeza que deseja apagar este projeto e sua Chave de API? Todos os sistemas que usam esta chave pararão de funcionar!')) return;
    
    try {
        const res = await fetch(`${API_BASE}/api/projects/${id}`, { method: 'DELETE' });
        if (!res.ok) throw new Error('Falha ao deletar');
        showToast('Projeto deletado!', 'success');
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

// Init
switchView('view-instances');
