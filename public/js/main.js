document.addEventListener('DOMContentLoaded', async () => {
    document.getElementById('footer-year').textContent = new Date().getFullYear();
    try {
        const { user } = await getJson('/api/auth/me');
        await showAuthenticatedView(user);
    } catch (error) {
        showLoginView();
    }
});

document.getElementById('login-form').addEventListener('submit', async event => {
    event.preventDefault();
    const loginForm = event.currentTarget;
    const message = document.getElementById('login-message');
    const submitButton = loginForm.querySelector('button[type="submit"]');
    submitButton.disabled = true;
    submitButton.setAttribute('aria-busy', 'true');
    submitButton.querySelector('.button-spinner').hidden = false;
    document.getElementById('login-button-label').textContent = 'Connexion…';
    message.className = 'form-message';
    message.textContent = 'Connexion en cours…';

    try {
        const { user } = await getJson('/api/auth/login', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                phone_number: document.getElementById('login-phone').value.trim(),
                password: document.getElementById('login-password').value,
            }),
        });
        loginForm.reset();
        message.textContent = '';
        await showAuthenticatedView(user);
    } catch (error) {
        message.textContent = error.message;
        message.className = 'form-message error-message';
    } finally {
        submitButton.disabled = false;
        submitButton.setAttribute('aria-busy', 'false');
        submitButton.querySelector('.button-spinner').hidden = true;
        document.getElementById('login-button-label').textContent = 'Se connecter';
    }
});

document.getElementById('logout-button').addEventListener('click', async () => {
    try {
        await getJson('/api/auth/logout', { method: 'POST' });
    } catch (error) {
        console.error('Erreur de déconnexion :', error);
    }
    showLoginView();
});

document.querySelector('.module-nav').addEventListener('click', event => {
    const button = event.target.closest('[data-view]');
    if (button) setActiveModuleView(button.dataset.view);
});

document.getElementById('report-filter-form').addEventListener('submit', async event => {
    event.preventDefault();
    await loadReportRows();
});

document.getElementById('report-export-button').addEventListener('click', exportReportCsv);

document.getElementById('tontine-form').addEventListener('submit', async event => {
    event.preventDefault();
    const form = event.currentTarget;
    const message = document.getElementById('tontine-message');

    try {
        await getJson('/api/tontines', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                name: document.getElementById('tontine-name').value.trim(),
                amount: Number(document.getElementById('tontine-amount').value),
                frequency: document.getElementById('tontine-frequency').value,
            }),
        });
        form.reset();
        document.getElementById('tontine-frequency').value = 'monthly';
        message.textContent = 'Tontine créée.';
        message.className = 'form-message success-message';
        await loadTontines();
    } catch (error) {
        message.textContent = error.message;
        message.className = 'form-message error-message';
    }
});

document.getElementById('tontine-member-form').addEventListener('submit', async event => {
    event.preventDefault();
    const message = document.getElementById('tontine-member-message');
    const tontineId = document.getElementById('tontine-member-group').value;
    const memberId = document.getElementById('tontine-member-user').value;

    try {
        await getJson(`/api/tontines/${encodeURIComponent(tontineId)}/members`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ member_id: Number(memberId) }),
        });
        message.textContent = 'Membre ajouté à la tontine.';
        message.className = 'form-message success-message';
        await loadTontines();
    } catch (error) {
        message.textContent = error.message;
        message.className = 'form-message error-message';
    }
});

let moduleNavigationToken = 0;

async function setActiveModuleView(view) {
    const navigationToken = ++moduleNavigationToken;
    const loadingScreen = document.getElementById('module-loading');
    const loadingLabel = document.getElementById('module-loading-label');
    const labels = {
        home: 'Actualisation du tableau de bord…',
        members: 'Ouverture des membres…',
        tontines: 'Ouverture des tontines…',
        sessions: 'Ouverture des réunions…',
        contributions: 'Ouverture des cotisations…',
        loans: 'Ouverture des prêts…',
        payments: 'Ouverture des paiements…',
        notifications: 'Ouverture des notifications…',
        reports: 'Préparation des rapports…',
    };

    loadingLabel.textContent = labels[view] || 'Ouverture de la rubrique…';
    loadingScreen.hidden = false;
    document.querySelectorAll('[data-section-view]').forEach(section => {
        section.hidden = true;
        section.inert = true;
    });

    document.querySelectorAll('.module-nav-item').forEach(button => {
        if (button.dataset.view === view) {
            button.setAttribute('aria-current', 'page');
        } else {
            button.removeAttribute('aria-current');
        }
    });

    const dataLoad = view === 'home'
        ? loadAdminOverview()
        : view === 'reports'
            ? loadReportRows()
            : Promise.resolve();
    await Promise.all([dataLoad, new Promise(resolve => window.setTimeout(resolve, 220))]);
    if (navigationToken !== moduleNavigationToken) return;

    document.querySelectorAll('[data-section-view]').forEach(section => {
        const isActive = section.dataset.sectionView === view;
        section.hidden = !isActive;
        section.inert = !isActive;
    });
    loadingScreen.hidden = true;
}

let currentReportRows = [];

async function loadReportRows() {
    const params = new URLSearchParams({
        start_date: document.getElementById('report-start-date').value,
        end_date: document.getElementById('report-end-date').value,
        type: document.getElementById('report-type').value,
    });
    const message = document.getElementById('report-message');
    const exportButton = document.getElementById('report-export-button');
    message.textContent = 'Chargement du rapport…';
    exportButton.disabled = true;

    try {
        const report = await getJson(`/api/admin/reports?${params.toString()}`);
        currentReportRows = report.rows;
        renderReportRows(currentReportRows);
        exportButton.disabled = currentReportRows.length === 0;
        message.textContent = `${currentReportRows.length} opération${currentReportRows.length > 1 ? 's' : ''}`;
    } catch (error) {
        currentReportRows = [];
        renderReportRows([]);
        message.textContent = error.message;
        exportButton.disabled = true;
    }
}

function renderReportRows(rows) {
    const body = document.getElementById('report-rows');
    body.replaceChildren();

    if (rows.length === 0) {
        const row = document.createElement('tr');
        const cell = document.createElement('td');
        cell.colSpan = 6;
        cell.className = 'empty-state';
        cell.textContent = 'Aucune opération sur cette période.';
        row.append(cell);
        body.append(row);
        return;
    }

    const labels = { contribution: 'Cotisation', payment: 'Paiement', loan: 'Prêt' };
    rows.forEach(record => {
        const row = document.createElement('tr');
        const values = [
            new Date(record.created_at).toLocaleDateString('fr-CM'),
            labels[record.type] || record.type,
            record.member_name,
            record.details,
            record.status,
            formatAmount(record.amount),
        ];
        values.forEach(value => {
            const cell = document.createElement('td');
            cell.textContent = value;
            row.append(cell);
        });
        body.append(row);
    });
}

function exportReportCsv() {
    if (currentReportRows.length === 0) return;

    const labels = { contribution: 'Cotisation', payment: 'Paiement', loan: 'Prêt' };
    const columns = ['Date', 'Type', 'Membre', 'Détail', 'Statut', 'Montant (FCFA)'];
    const csvCell = value => {
        const safeValue = /^[\s]*[=+@-]/.test(String(value)) ? `'${value}` : String(value);
        return `"${safeValue.replaceAll('"', '""')}"`;
    };
    const lines = [columns, ...currentReportRows.map(record => [
        new Date(record.created_at).toLocaleDateString('fr-CM'),
        labels[record.type] || record.type,
        record.member_name,
        record.details,
        record.status,
        record.amount,
    ])].map(row => row.map(csvCell).join(';'));
    const blob = new Blob([`\uFEFF${lines.join('\r\n')}`], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = 'rapport-tontine.csv';
    link.click();
    URL.revokeObjectURL(url);
}

async function loadAdminOverview() {
    try {
        const overview = await getJson('/api/admin/overview');
        document.getElementById('overview-members').textContent = overview.members;
        document.getElementById('overview-contributions').textContent = formatAmount(overview.paidContributions);
        document.getElementById('overview-payments').textContent = formatAmount(overview.confirmedPayments);
        document.getElementById('overview-loans').textContent = formatAmount(overview.outstandingLoans);
        document.getElementById('overview-sessions').textContent = overview.upcomingSessions;
        renderRecentActivity(overview.recentActivity);
    } catch (error) {
        console.error('Erreur de chargement des indicateurs :', error);
        document.getElementById('recent-activity-list').textContent = 'Impossible de charger les indicateurs.';
    }
}

function renderRecentActivity(records) {
    const list = document.getElementById('recent-activity-list');
    list.replaceChildren();

    if (records.length === 0) {
        const emptyState = document.createElement('p');
        emptyState.className = 'empty-state';
        emptyState.textContent = 'Aucune activité récente.';
        list.append(emptyState);
        return;
    }

    records.forEach(record => {
        const item = document.createElement('article');
        item.className = 'activity-entry';

        const category = document.createElement('span');
        category.className = 'activity-category';
        category.textContent = record.category;

        const details = document.createElement('div');
        details.className = 'activity-details';
        const description = document.createElement('p');
        description.className = 'activity-description';
        description.textContent = record.description;
        const date = document.createElement('time');
        date.className = 'activity-date';
        date.dateTime = record.occurred_at;
        date.textContent = new Date(record.occurred_at).toLocaleString('fr-CM');
        details.append(description, date);

        const amount = document.createElement('strong');
        amount.className = 'activity-amount';
        amount.textContent = formatAmount(record.amount);

        item.append(category, details, amount);
        list.append(item);
    });
}

function showLoginView() {
    document.getElementById('startup-loading').hidden = true;
    document.getElementById('auth-screen').hidden = false;
    document.getElementById('member-space').hidden = true;
    document.getElementById('admin-dashboard').hidden = true;
    document.getElementById('account-actions').hidden = true;
}

async function showAuthenticatedView(user) {
    document.getElementById('auth-screen').hidden = true;
    document.getElementById('startup-loading').hidden = true;
    document.getElementById('account-actions').hidden = false;
    document.getElementById('account-name').textContent = `${user.full_name} · ${user.role === 'admin' ? 'Administrateur' : 'Membre'}`;

    if (user.role === 'admin') {
        document.getElementById('member-space').hidden = true;
        document.getElementById('admin-dashboard').hidden = false;
        await setActiveModuleView('home');
        await loadAdminDashboard();
        return;
    }

    document.getElementById('admin-dashboard').hidden = true;
    document.getElementById('member-space').hidden = false;
    document.getElementById('member-loading').hidden = false;
    document.getElementById('member-overview-grid').hidden = true;
    await loadMemberOverview();
}

async function loadAdminDashboard() {
    await Promise.all([
        loadMembers(),
        loadTontineMembers(),
        loadTontines(),
        loadSessions(),
        loadMembersForContribution(),
        loadLoans(),
        loadNotifications(),
        loadPayments()
    ]);

    const contributionSession = document.getElementById('contribution-session');
    contributionSession.onchange = () => {
        loadContributions(contributionSession.value);
    };

    loadContributions(contributionSession.value);
    loadLoanMembers();
    loadPaymentMembers();
    loadPaymentSessions();
}

async function loadMemberOverview() {
    try {
        const overview = await getJson('/api/me/overview');
        document.getElementById('member-space-heading').textContent = `Bonjour ${overview.user.full_name}`;
        document.getElementById('member-tontine-count').textContent = overview.tontines.length;
        document.getElementById('member-session-count').textContent = overview.upcomingSessions.length;
        const paidContributions = overview.contributions
            .filter(contribution => contribution.status === 'paid')
            .reduce((total, contribution) => total + Number(contribution.amount), 0);
        document.getElementById('member-contribution-total').textContent = formatAmount(paidContributions);
        renderPersonalList('my-tontines', overview.tontines, tontine =>
            `${formatAmount(tontine.amount)} · ${formatFrequency(tontine.frequency)} · depuis le ${new Date(tontine.joined_at).toLocaleDateString('fr-CM')}`);
        renderPersonalList('my-upcoming-sessions', overview.upcomingSessions, session =>
            `${session.tontine_name} · ${new Date(session.date).toLocaleString('fr-CM')} · ${session.status}`);
        renderPersonalList('my-contributions', overview.contributions, contribution =>
            `${formatAmount(contribution.amount)} · ${contribution.status}`);
        renderPersonalList('my-loans', overview.loans, loan =>
            `${formatAmount(loan.total_amount)} · ${loan.status} · échéance ${new Date(loan.due_date).toLocaleDateString('fr-CM')}`);
        renderPersonalList('my-payments', overview.payments, payment =>
            `${formatAmount(payment.amount)} · ${payment.status} · ${payment.session_title || payment.method}`);
        renderPersonalList('my-notifications', overview.notifications, notification =>
            `${notification.title} · ${notification.message}`);
        document.getElementById('member-loading').hidden = true;
        document.getElementById('member-overview-grid').hidden = false;
    } catch (error) {
        console.error('Erreur de chargement de l’espace membre :', error);
        document.getElementById('member-loading').hidden = true;
        document.getElementById('member-overview-grid').hidden = false;
        document.getElementById('my-tontines').textContent = 'Impossible de charger vos données pour le moment.';
    }
}

async function loadTontineMembers() {
    const select = document.getElementById('tontine-member-user');
    try {
        const members = await getJson('/api/members');
        populateSelect(select, members.filter(member => member.role === 'member'), 'full_name', 'id');
    } catch (error) {
        console.error('Erreur de chargement des membres des tontines :', error);
    }
}

function renderPersonalList(elementId, records, describeRecord) {
    const list = document.getElementById(elementId);
    list.replaceChildren();

    if (!records.length) {
        const emptyState = document.createElement('p');
        emptyState.className = 'empty-state';
        emptyState.textContent = 'Aucune donnée à afficher.';
        list.append(emptyState);
        return;
    }

    records.forEach(record => {
        const item = document.createElement('article');
        item.className = 'data-card';
        const description = document.createElement('p');
        description.className = 'data-card-description';
        description.textContent = describeRecord(record);
        item.append(description);
        list.append(item);
    });
}

// Test de connexion PostgreSQL
document.getElementById('btn-test').addEventListener('click', async () => {
    const statusElement = document.getElementById('status');
    statusElement.innerText = "Interrogation de la base de données...";

    try {
        const response = await fetch('/api/health');
        const data = await response.json();

        if (data.status === 'OK') {
            statusElement.innerText = `Connecté à PostgreSQL ! Heure DB: ${data.dbTime}`;
            statusElement.style.color = 'green';
        } else {
            statusElement.innerText = `Erreur: ${data.error}`;
            statusElement.style.color = 'red';
        }
    } catch (error) {
        statusElement.innerText = "Impossible de contacter le serveur Express.";
        statusElement.style.color = 'red';
    }
});

// Formulaire d'ajout de membre
document.getElementById('member-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const messageEl = document.getElementById('form-message');

    const memberData = {
        full_name: document.getElementById('full_name').value,
        phone_number: document.getElementById('phone_number').value,
        password: document.getElementById('member-password').value,
        role: document.getElementById('role').value
    };

    try {
        const response = await fetch('/api/members', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(memberData)
        });

        const result = await response.json();

        if (response.ok) {
            messageEl.innerText = "Membre ajouté avec succès !";
            messageEl.style.color = "green";
            document.getElementById('member-form').reset();
            await loadMembers();
        } else {
            messageEl.innerText = `Erreur: ${result.error}`;
            messageEl.style.color = "red";
        }
    } catch (err) {
        messageEl.innerText = "Erreur lors de l'enregistrement.";
        messageEl.style.color = "red";
    }
});

// Chargement et affichage des membres
async function loadMembers() {
    const listEl = document.getElementById('members-list');
    if (!listEl) return;

    try {
        const response = await fetch('/api/members');
        const members = await response.json();

        if (!response.ok) {
            throw new Error(members.error || 'Impossible de charger les membres.');
        }

        if (!Array.isArray(members) || members.length === 0) {
            listEl.innerHTML = '<li>Aucun membre trouvé.</li>';
            return;
        }

        listEl.replaceChildren();

        members.forEach(member => {
            const item = document.createElement('li');
            item.className = 'member-item';

            const card = document.createElement('article');
            card.className = 'member-card';

            const name = document.createElement('h3');
            name.textContent = member.full_name;

            const phone = document.createElement('p');
            phone.textContent = `Téléphone : ${member.phone_number}`;

            const role = document.createElement('p');
            role.textContent = `Rôle : ${member.role}`;

            card.append(name, phone, role);
            item.append(card);
            listEl.append(item);
        });
    } catch (err) {
        console.error('Erreur lors du chargement :', err);
        listEl.innerHTML = '<li>Impossible de charger les membres.</li>';
    }
}

// -------------------------------------------------------------------------
// Gestion des sessions et cotisations
// -------------------------------------------------------------------------

async function getJson(url, options = {}) {
    const response = await fetch(url, options);
    const data = await response.json();

    if (!response.ok) {
        throw new Error(data.error || 'Une erreur est survenue.');
    }

    return data;
}

function populateSelect(selectElement, values, labelSource, valueKey) {
    selectElement.replaceChildren();

    const placeholder = document.createElement('option');
    placeholder.value = '';
    placeholder.textContent = 'Sélectionnez une option';
    selectElement.append(placeholder);

    values.forEach(value => {
        const option = document.createElement('option');
        option.value = value[valueKey];
        option.textContent = typeof labelSource === 'function'
            ? labelSource(value)
            : value[labelSource];
        selectElement.append(option);
    });
}

async function loadTontines() {
    try {
        const tontines = await getJson('/api/tontines');
        populateSelect(document.getElementById('session-tontine'), tontines, 'name', 'id');
        populateSelect(document.getElementById('tontine-member-group'), tontines, 'name', 'id');

        const list = document.getElementById('tontines-list');
        list.replaceChildren();
        if (tontines.length === 0) {
            const emptyState = document.createElement('p');
            emptyState.className = 'empty-state';
            emptyState.textContent = 'Aucune tontine créée pour le moment.';
            list.append(emptyState);
            return;
        }

        tontines.forEach(tontine => {
            const item = document.createElement('article');
            item.className = 'data-card';
            const name = document.createElement('h3');
            name.textContent = tontine.name;
            const amount = document.createElement('p');
            amount.className = 'data-card-meta';
            amount.textContent = `${formatAmount(tontine.amount)} · ${formatFrequency(tontine.frequency)}`;
            const members = document.createElement('p');
            members.className = 'data-card-description';
            members.textContent = `${tontine.member_count} membre${tontine.member_count === 1 ? '' : 's'}`;
            item.append(name, amount, members);
            list.append(item);
        });
    } catch (error) {
        console.error('Erreur de chargement des tontines :', error);
    }
}

function formatFrequency(frequency) {
    return {
        weekly: 'chaque semaine',
        monthly: 'chaque mois',
        quarterly: 'chaque trimestre',
        yearly: 'chaque année',
    }[frequency] || frequency;
}

function createStatusBadge(status) {
    const badge = document.createElement('span');
    badge.className = `status-badge status-${status}`;
    badge.textContent = status;
    return badge;
}

async function loadSessions() {
    try {
        const sessions = await getJson('/api/sessions');
        const list = document.getElementById('sessions-list');
        const select = document.getElementById('contribution-session');
        list.replaceChildren();

        if (sessions.length === 0) {
            const emptyState = document.createElement('p');
            emptyState.className = 'empty-state';
            emptyState.textContent = 'Aucune session n’a encore été créée.';
            list.append(emptyState);
            select.replaceChildren();
            return;
        }

        populateSelect(
            select,
            sessions,
            session => `${session.title} - ${session.tontine_name}`,
            'id'
        );

        sessions.forEach(session => {
            const item = document.createElement('article');
            item.className = 'data-card';

            const header = document.createElement('div');
            header.className = 'data-card-header';

            const title = document.createElement('h3');
            title.textContent = session.title;
            header.append(title, createStatusBadge(session.status));

            const details = document.createElement('p');
            details.className = 'data-card-meta';
            details.textContent = `${session.tontine_name} • ${new Date(session.date).toLocaleString('fr-CM')}`;

            const agenda = document.createElement('p');
            agenda.className = 'data-card-description';
            agenda.textContent = session.agenda || 'Aucun ordre du jour spécifié.';

            const statusControl = document.createElement('label');
            statusControl.className = 'status-control';
            statusControl.textContent = 'Modifier le statut : ';

            const statusSelect = document.createElement('select');
            statusSelect.className = 'status-select';
            statusSelect.dataset.sessionId = session.id;
            statusSelect.setAttribute('aria-label', `Modifier le statut de ${session.title}`);

            ['scheduled', 'ongoing', 'completed', 'cancelled'].forEach(status => {
                const option = document.createElement('option');
                option.value = status;
                option.textContent = {
                    scheduled: 'Prévue',
                    ongoing: 'En cours',
                    completed: 'Clôturée',
                    cancelled: 'Annulée'
                }[status];
                option.selected = status === session.status;
                statusSelect.append(option);
            });

            statusControl.append(statusSelect);
            item.append(header, details, agenda, statusControl);
            list.append(item);
        });
    } catch (error) {
        console.error('Erreur de chargement des sessions :', error);
    }
}

async function loadMembersForContribution() {
    try {
        const members = await getJson('/api/members');
        const select = document.getElementById('contribution-member');
        populateSelect(select, members, 'full_name', 'id');
    } catch (error) {
        console.error('Erreur de chargement des membres :', error);
    }
}

function formatAmount(amount) {
    return new Intl.NumberFormat('fr-CM', {
        style: 'currency',
        currency: 'XAF',
        maximumFractionDigits: 2
    }).format(Number(amount));
}

async function loadContributions(sessionId) {
    const list = document.getElementById('contributions-list');
    list.replaceChildren();

    if (!sessionId) {
        const emptyState = document.createElement('p');
        emptyState.className = 'empty-state';
        emptyState.textContent = 'Sélectionnez une session pour voir les cotisations.';
        list.append(emptyState);
        return;
    }

    try {
        const contributions = await getJson(`/api/contributions?session_id=${encodeURIComponent(sessionId)}`);

        if (contributions.length === 0) {
            const emptyState = document.createElement('p');
            emptyState.className = 'empty-state';
            emptyState.textContent = 'Aucune cotisation n’a encore été enregistrée pour cette session.';
            list.append(emptyState);
            return;
        }

        contributions.forEach(contribution => {
            const item = document.createElement('article');
            item.className = 'data-card';

            const header = document.createElement('div');
            header.className = 'data-card-header';

            const member = document.createElement('h3');
            member.textContent = contribution.full_name;
            header.append(member, createStatusBadge(contribution.status));

            const amount = document.createElement('p');
            amount.className = 'data-card-meta';
            amount.textContent = formatAmount(contribution.amount);

            const date = document.createElement('p');
            date.className = 'data-card-description';
            date.textContent = contribution.paid_at
                ? `Payé le ${new Date(contribution.paid_at).toLocaleString('fr-CM')}`
                : 'Cotisation en attente ou non réglée';

            item.append(header, amount, date);
            list.append(item);
        });
    } catch (error) {
        const errorState = document.createElement('p');
        errorState.className = 'empty-state';
        errorState.textContent = `Impossible de charger les cotisations : ${error.message}`;
        list.append(errorState);
        console.error('Erreur de chargement des cotisations :', error);
    }
}

document.getElementById('session-form').addEventListener('submit', async event => {
    event.preventDefault();
    const message = document.getElementById('session-message');

    const sessionData = {
        tontine_id: Number(document.getElementById('session-tontine').value),
        title: document.getElementById('session-title').value.trim(),
        date: document.getElementById('session-date').value,
        agenda: document.getElementById('session-agenda').value.trim(),
        status: document.getElementById('session-status').value
    };

    try {
        const result = await getJson('/api/sessions', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(sessionData)
        });

        message.textContent = 'Session créée avec succès !';
        message.style.color = 'green';
        document.getElementById('session-form').reset();
        await loadSessions();
        await loadTontines();
        console.log('Session créée :', result.id);
    } catch (error) {
        message.textContent = `Erreur : ${error.message}`;
        message.style.color = 'red';
    }
});

document.getElementById('sessions-list').addEventListener('change', async event => {
    const select = event.target.closest('.status-select');
    if (!select) return;

    try {
        await getJson(`/api/sessions/${select.dataset.sessionId}/status`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ status: select.value })
        });
        await loadSessions();
    } catch (error) {
        console.error('Erreur de modification du statut :', error);
        alert(`Impossible de modifier le statut : ${error.message}`);
    }
});

function loadLoanMembers() {
    const memberSelect = document.getElementById('loan-member');
    memberSelect.replaceChildren();

    const placeholder = document.createElement('option');
    placeholder.value = '';
    placeholder.textContent = 'Sélectionnez un membre';
    memberSelect.append(placeholder);

    fetch('/api/members')
        .then(response => response.json())
        .then(members => {
            members.filter(member => member.role === 'member').forEach(member => {
                const option = document.createElement('option');
                option.value = member.id;
                option.textContent = member.full_name;
                memberSelect.append(option);
            });
        })
        .catch(error => console.error('Erreur de chargement des membres :', error));
}

function loadPaymentMembers() {
    const memberSelect = document.getElementById('payment-member');
    memberSelect.replaceChildren();

    const placeholder = document.createElement('option');
    placeholder.value = '';
    placeholder.textContent = 'Sélectionnez un membre';
    memberSelect.append(placeholder);

    fetch('/api/members')
        .then(response => response.json())
        .then(members => {
            members.forEach(member => {
                const option = document.createElement('option');
                option.value = member.id;
                option.textContent = member.full_name;
                memberSelect.append(option);
            });
        })
        .catch(error => console.error('Erreur de chargement des membres du paiement :', error));
}

async function loadPaymentSessions() {
    const sessionSelect = document.getElementById('payment-session');
    if (!sessionSelect) return;

    sessionSelect.replaceChildren();
    const placeholder = document.createElement('option');
    placeholder.value = '';
    placeholder.textContent = 'Sélectionnez une session (facultatif)';
    sessionSelect.append(placeholder);

    try {
        const sessions = await getJson('/api/sessions');
        sessions.forEach(session => {
            const option = document.createElement('option');
            option.value = session.id;
            option.textContent = `${session.title} - ${session.tontine_name}`;
            sessionSelect.append(option);
        });
    } catch (error) {
        console.error('Erreur de chargement des sessions pour le paiement :', error);
    }
}

async function loadPayments() {
    const list = document.getElementById('payments-list');
    if (!list) return;

    list.replaceChildren();
    try {
        const payments = await getJson('/api/payments');
        if (payments.length === 0) {
            const emptyState = document.createElement('p');
            emptyState.className = 'empty-state';
            emptyState.textContent = 'Aucun paiement enregistré.';
            list.append(emptyState);
            return;
        }

        payments.forEach(payment => {
            const item = document.createElement('article');
            item.className = 'data-card';

            const header = document.createElement('div');
            header.className = 'data-card-header';
            const title = document.createElement('h3');
            title.textContent = payment.full_name;
            header.append(title, createStatusBadge(payment.status));

            const amount = document.createElement('p');
            amount.className = 'data-card-meta';
            amount.textContent = `${formatAmount(payment.amount)} • ${payment.method}`;

            const details = document.createElement('p');
            details.className = 'data-card-description';
            details.textContent = payment.reference || payment.session_title || 'Paiement sans référence';

            item.append(header, amount, details);
            list.append(item);
        });
    } catch (error) {
        console.error('Erreur de chargement des paiements :', error);
    }
}

async function loadNotifications() {
    const list = document.getElementById('notifications-list');
    if (!list) return;

    list.replaceChildren();
    try {
        const notifications = await getJson('/api/notifications');
        if (notifications.length === 0) {
            const emptyState = document.createElement('p');
            emptyState.className = 'empty-state';
            emptyState.textContent = 'Aucune notification pour le moment.';
            list.append(emptyState);
            return;
        }

        notifications.slice(0, 5).forEach(notification => {
            const item = document.createElement('article');
            item.className = 'data-card';

            const title = document.createElement('h3');
            title.textContent = notification.title;

            const message = document.createElement('p');
            message.className = 'data-card-description';
            message.textContent = notification.message;

            item.append(title, message);
            list.append(item);
        });
    } catch (error) {
        console.error('Erreur de chargement des notifications :', error);
    }
}

function formatLoanAmount(amount) {
    return new Intl.NumberFormat('fr-CM', {
        style: 'currency',
        currency: 'XAF',
        maximumFractionDigits: 2
    }).format(Number(amount));
}

async function loadLoans() {
    const list = document.getElementById('loans-list');
    list.replaceChildren();

    try {
        const loans = await getJson('/api/loans');
        if (loans.length === 0) {
            const emptyState = document.createElement('p');
            emptyState.className = 'empty-state';
            emptyState.textContent = 'Aucun prêt n’a encore été demandé.';
            list.append(emptyState);
            return;
        }

        loans.forEach(loan => {
            const item = document.createElement('article');
            item.className = 'data-card';

            const header = document.createElement('div');
            header.className = 'data-card-header';
            const member = document.createElement('h3');
            member.textContent = loan.full_name;
            header.append(member, createStatusBadge(loan.status));

            const amounts = document.createElement('p');
            amounts.className = 'data-card-meta';
            amounts.textContent = `Principal ${formatLoanAmount(loan.amount)} • Intérêt ${formatLoanAmount(loan.interest)}`;

            const total = document.createElement('p');
            total.className = 'data-card-description';
            total.textContent = `Total ${formatLoanAmount(loan.total_amount)} • Échéance ${new Date(loan.due_date).toLocaleDateString('fr-CM')}`;

            const repayment = document.createElement('form');
            repayment.className = 'repayment-form';
            repayment.dataset.loanId = loan.id;

            const repaymentInput = document.createElement('input');
            repaymentInput.type = 'number';
            repaymentInput.min = '1';
            repaymentInput.step = '1';
            repaymentInput.placeholder = 'Montant du remboursement';
            repaymentInput.required = true;

            const repaymentButton = document.createElement('button');
            repaymentButton.type = 'submit';
            repaymentButton.className = 'secondary-button';
            repaymentButton.textContent = 'Rembourser';

            repayment.append(repaymentInput, repaymentButton);
            item.append(header, amounts, total, repayment);
            list.append(item);
        });
    } catch (error) {
        const errorState = document.createElement('p');
        errorState.className = 'empty-state';
        errorState.textContent = `Impossible de charger les prêts : ${error.message}`;
        list.append(errorState);
        console.error('Erreur de chargement des prêts :', error);
    }
}

document.getElementById('loans-list').addEventListener('submit', async event => {
    const form = event.target.closest('.repayment-form');
    if (!form) return;

    event.preventDefault();
    const amount = Number(form.querySelector('input').value);

    try {
        await getJson(`/api/loans/${form.dataset.loanId}/repayments`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ amount })
        });
        await loadLoans();
    } catch (error) {
        console.error('Erreur de remboursement :', error);
        alert(`Impossible d’enregistrer le remboursement : ${error.message}`);
    }
});

document.getElementById('loan-form').addEventListener('submit', async event => {
    event.preventDefault();
    const message = document.getElementById('loan-message');
    const loanData = {
        user_id: Number(document.getElementById('loan-member').value),
        amount: Number(document.getElementById('loan-amount').value),
        interest_rate: Number(document.getElementById('loan-interest-rate').value),
        due_date: document.getElementById('loan-due-date').value
    };

    try {
        await getJson('/api/loans', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(loanData)
        });
        message.textContent = 'Prêt demandé avec succès !';
        message.style.color = 'green';
        document.getElementById('loan-form').reset();
        await loadLoans();
    } catch (error) {
        message.textContent = `Erreur : ${error.message}`;
        message.style.color = 'red';
    }
});

document.getElementById('payment-form').addEventListener('submit', async event => {
    event.preventDefault();
    const message = document.getElementById('payment-message');

    const paymentData = {
        user_id: Number(document.getElementById('payment-member').value),
        session_id: document.getElementById('payment-session').value
            ? Number(document.getElementById('payment-session').value)
            : null,
        amount: Number(document.getElementById('payment-amount').value),
        method: document.getElementById('payment-method').value,
        reference: document.getElementById('payment-reference').value.trim(),
        status: 'paid'
    };

    try {
        await getJson('/api/payments', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(paymentData)
        });

        message.textContent = 'Paiement validé avec succès !';
        message.style.color = 'green';
        document.getElementById('payment-form').reset();
        await loadPayments();
        await loadNotifications();
    } catch (error) {
        message.textContent = `Erreur : ${error.message}`;
        message.style.color = 'red';
    }
});

document.getElementById('contribution-form').addEventListener('submit', async event => {
    event.preventDefault();
    const message = document.getElementById('contribution-message');

    const contributionData = {
        session_id: Number(document.getElementById('contribution-session').value),
        user_id: Number(document.getElementById('contribution-member').value),
        amount: Number(document.getElementById('contribution-amount').value),
        status: document.getElementById('contribution-status').value
    };

    try {
        const result = await getJson('/api/contributions', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(contributionData)
        });

        message.textContent = 'Cotisation enregistrée avec succès !';
        message.style.color = 'green';
        document.getElementById('contribution-form').reset();
        await loadContributions(contributionData.session_id);
        console.log('Cotisation enregistrée :', result.id);
    } catch (error) {
        message.textContent = `Erreur : ${error.message}`;
        message.style.color = 'red';
    }
});