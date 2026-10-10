document.addEventListener('DOMContentLoaded', async () => {
    try {
        const { user } = await getJson('/api/auth/me');
        showAuthenticatedView(user);
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

function showLoginView() {
    document.getElementById('auth-screen').hidden = false;
    document.getElementById('member-space').hidden = true;
    document.getElementById('admin-dashboard').hidden = true;
    document.getElementById('account-actions').hidden = true;
}

async function showAuthenticatedView(user) {
    document.getElementById('auth-screen').hidden = true;
    document.getElementById('account-actions').hidden = false;
    document.getElementById('account-name').textContent = `${user.full_name} · ${user.role === 'admin' ? 'Administrateur' : 'Membre'}`;

    if (user.role === 'admin') {
        document.getElementById('member-space').hidden = true;
        document.getElementById('admin-dashboard').hidden = false;
        await loadAdminDashboard();
        return;
    }

    document.getElementById('admin-dashboard').hidden = true;
    document.getElementById('member-space').hidden = false;
    await loadMemberOverview();
}

async function loadAdminDashboard() {
    await Promise.all([
        loadMembers(),
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
        renderPersonalList('my-contributions', overview.contributions, contribution =>
            `${formatAmount(contribution.amount)} · ${contribution.status}`);
        renderPersonalList('my-loans', overview.loans, loan =>
            `${formatAmount(loan.total_amount)} · ${loan.status} · échéance ${new Date(loan.due_date).toLocaleDateString('fr-CM')}`);
        renderPersonalList('my-payments', overview.payments, payment =>
            `${formatAmount(payment.amount)} · ${payment.status} · ${payment.session_title || payment.method}`);
        renderPersonalList('my-notifications', overview.notifications, notification =>
            `${notification.title} · ${notification.message}`);
    } catch (error) {
        console.error('Erreur de chargement de l’espace membre :', error);
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
        const select = document.getElementById('session-tontine');
        populateSelect(select, tontines, 'name', 'id');
    } catch (error) {
        console.error('Erreur de chargement des tontines :', error);
    }
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
        currency: 'FCFA',
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
            members.forEach(member => {
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
        currency: 'FCFA',
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