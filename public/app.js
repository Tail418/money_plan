// 가계부 화면. 서버 API를 fetch로 호출해서 그린다.

const $ = (selector, root = document) => root.querySelector(selector);
const won = n => `${Number(n).toLocaleString('ko-KR')}원`;
const esc = text => String(text ?? '').replace(/[&<>"']/g,
    c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const pad = n => String(n).padStart(2, '0');
const today = () => {
    const d = new Date();
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
};

const ACCOUNT_TYPE = { bank: '통장', card: '카드', cash: '현금', etc: '기타' };

const state = { user: null, month: today().slice(0, 7), view: 'home', page: 1, q: '', categories: [], accounts: [] };

// ---------- 서버 호출 ----------
async function api(method, url, body) {
    const res = await fetch(url, {
        method,
        headers: body ? { 'Content-Type': 'application/json' } : {},
        body: body ? JSON.stringify(body) : undefined
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
        const error = new Error(data.message || `요청이 실패했습니다 (${res.status})`);
        error.status = res.status;
        throw error;
    }
    return data;
}

// ---------- 알림 ----------
let noticeTimer;
function notice(message, isError = false) {
    const box = $('#notice');
    box.textContent = message;
    box.className = isError ? 'error' : '';
    box.hidden = false;
    clearTimeout(noticeTimer);
    noticeTimer = setTimeout(() => { box.hidden = true; }, 3500);
}

// 실패하면 알림을 띄우고, 로그인이 풀렸으면 로그인 화면으로 돌아간다.
async function run(task) {
    try {
        await task();
    } catch (error) {
        if (error.status === 401 && state.user) { state.user = null; showAuth(); }
        notice(error.message, true);
    }
}

// 폼 제출 공통 처리: 값을 객체로 모아 handler에 넘긴다.
function onSubmit(selector, handler) {
    $(selector).addEventListener('submit', event => {
        event.preventDefault();
        const form = event.target;
        run(() => handler(Object.fromEntries(new FormData(form)), form));
    });
}

// ---------- 로그인 ----------
let signupMode = false;

function showAuth() {
    $('#app').hidden = true;
    $('#auth').hidden = false;
}

function setSignupMode(on) {
    signupMode = on;
    $('#name-field').hidden = !on;
    $('#name-field input').required = on;
    $('#auth-submit').textContent = on ? '회원가입' : '로그인';
    $('#auth-toggle').textContent = on ? '이미 가입했으면 로그인' : '처음이면 회원가입';
    $('#auth-lead').textContent = on
        ? '가입하면 식비, 교통 같은 기본 카테고리가 만들어져 있습니다.'
        : '쓴 돈과 번 돈을 한 줄씩 적어 두는 곳.';
}

$('#auth-toggle').addEventListener('click', () => setSignupMode(!signupMode));

onSubmit('#auth-form', async ({ id, name, password }, form) => {
    if (signupMode) await api('POST', '/auth/signup', { id, name, password });
    state.user = await api('POST', '/auth/login', { id, password });
    form.reset();
    setSignupMode(false);
    await showApp();
});

$('#logout').addEventListener('click', () => run(async () => {
    await api('POST', '/auth/logout');
    state.user = null;
    showAuth();
}));

// ---------- 공통 데이터 (카테고리, 결제수단) ----------
async function loadBasics() {
    [state.categories, state.accounts] = await Promise.all([
        api('GET', '/categories'),
        api('GET', '/accounts')
    ]);
    fillSelects();
}

const options = (items, label = item => item.name) =>
    items.map(item => `<option value="${item.id}">${esc(label(item))}</option>`).join('');

function fillSelects() {
    const txType = $('#tx-form [name=type]').value;
    $('#tx-form [name=categoryId]').innerHTML = options(state.categories.filter(c => c.type === txType));
    $('#tx-form [name=accountId]').innerHTML = '<option value="">선택 안 함</option>' + options(state.accounts);
    $('#budget-form [name=categoryId]').innerHTML = options(state.categories.filter(c => c.type === 'expense'));
    $('#transfer-form [name=fromAccountId]').innerHTML = options(state.accounts);
    $('#transfer-form [name=toAccountId]').innerHTML = options(state.accounts);
    if (state.accounts.length > 1) $('#transfer-form [name=toAccountId]').selectedIndex = 1;
}

$('#tx-form [name=type]').addEventListener('change', fillSelects);

// ---------- 화면 전환 ----------
const views = { home: renderHome, ledger: renderLedger, budget: renderBudget, manage: renderManage };

function show(view) {
    state.view = view;
    Object.keys(views).forEach(name => { $(`#view-${name}`).hidden = name !== view; });
    document.querySelectorAll('.tabs button').forEach(button =>
        button.setAttribute('aria-selected', button.dataset.view === view));
    run(views[view]);
}

document.querySelectorAll('.tabs button').forEach(button =>
    button.addEventListener('click', () => show(button.dataset.view)));

$('#month').addEventListener('change', event => {
    if (!event.target.value) return;
    state.month = event.target.value;
    state.page = 1;
    show(state.view);
});

async function showApp() {
    $('#auth').hidden = true;
    $('#app').hidden = false;
    $('#who').textContent = state.user.name;
    $('#month').value = state.month;
    $('#tx-form [name=date]').value = today();
    await loadBasics();
    show('home');
}

const monthLabel = () => `${Number(state.month.slice(5))}월`;

// 거래 한 줄. withDelete가 true면 지우기 버튼이 붙는다.
function txRow(t, withDelete) {
    const transfer = t.transferId !== null;
    const label = transfer ? '이체' : (t.Category ? t.Category.name : '');
    const amount = `<td class="num ${t.type}">${t.type === 'expense' ? '-' : '+'}${won(t.amount)}</td>`;
    return `<tr>
        <td class="date">${esc(t.date.slice(5).replace('-', '.'))}</td>
        <td>${esc(label)}</td>
        <td>${esc(t.memo)}</td>
        <td class="hide-narrow muted">${esc(t.Account ? t.Account.name : '')}</td>
        ${amount}
        ${withDelete ? `<td class="num"><button class="link" data-delete-tx="${t.id}">지우기</button></td>` : ''}
    </tr>`;
}

const txHead = withDelete => `<thead><tr>
    <th>날짜</th><th>카테고리</th><th>메모</th><th class="hide-narrow">결제수단</th><th class="num">금액</th>
    ${withDelete ? '<th></th>' : ''}</tr></thead>`;

const emptyRow = (message, columns) => `<tr class="empty"><td colspan="${columns}">${message}</td></tr>`;

// ---------- 이번 달 ----------
async function renderHome() {
    const month = state.month;
    const [summary, byCategory, alerts, recent] = await Promise.all([
        api('GET', `/stats/monthly?month=${month}`),
        api('GET', `/stats/by-category?month=${month}`),
        api('GET', `/budgets/alerts?month=${month}`),
        api('GET', '/transactions/recent?limit=5')
    ]);

    $('#home-label').textContent = `${monthLabel()}에 남은 돈`;
    $('#home-balance').textContent = won(summary.balance);
    $('#home-balance').className = `balance ${summary.balance < 0 ? 'expense' : ''}`;
    $('#home-income').textContent = won(summary.income);
    $('#home-expense').textContent = won(summary.expense);

    $('#home-categories').innerHTML = byCategory.items.length
        ? byCategory.items.map(item => `<div class="meter">
            <div class="row"><span>${esc(item.name)}</span><span>${won(item.total)} <span class="muted small">${item.ratio}%</span></span></div>
            <div class="bar"><i style="width:${item.ratio}%"></i></div>
        </div>`).join('')
        : `<p class="muted">${monthLabel()}에 적은 지출이 없습니다.</p>`;

    $('#home-alerts').innerHTML = alerts.length
        ? alerts.map(meter).join('')
        : '<p class="muted">예산의 80%를 넘긴 카테고리가 없습니다.</p>';

    $('#home-recent').innerHTML = txHead(false) + '<tbody>' +
        (recent.map(t => txRow(t, false)).join('') || emptyRow('아직 적은 거래가 없습니다. 거래 탭에서 첫 줄을 적어 보세요.', 5)) +
        '</tbody>';
}

// 예산 한 줄 (이름, 쓴 돈 / 예산, 막대)
function meter(item, withDelete = false) {
    const level = item.spent > item.amount ? 'exceeded' : item.rate >= 80 ? 'warning' : '';
    const rest = item.remaining >= 0 ? `${won(item.remaining)} 남음` : `${won(-item.remaining)} 초과`;
    return `<div class="meter">
        <div class="row">
            <span>${esc(item.categoryName)} <span class="muted small">${rest}</span></span>
            <span>${won(item.spent)} / ${won(item.amount)}
                ${withDelete === true ? `<button class="link" data-delete-budget="${item.id}">지우기</button>` : ''}</span>
        </div>
        <div class="bar ${level}"><i style="width:${Math.min(item.rate, 100)}%"></i></div>
    </div>`;
}

// ---------- 거래 ----------
async function renderLedger() {
    const query = new URLSearchParams({ month: state.month, page: state.page, limit: 15 });
    if (state.q) query.set('q', state.q);
    const data = await api('GET', `/transactions?${query}`);

    $('#tx-table').innerHTML = txHead(true) + '<tbody>' +
        (data.items.map(t => txRow(t, true)).join('') ||
            emptyRow(state.q ? `'${esc(state.q)}'이(가) 들어간 거래가 없습니다.` : `${monthLabel()}에 적은 거래가 없습니다.`, 6)) +
        '</tbody>';

    $('#page-info').textContent = `${data.total}건 중 ${data.page} / ${Math.max(data.totalPages, 1)}쪽`;
    $('#prev').disabled = data.page <= 1;
    $('#next').disabled = data.page >= data.totalPages;
    $('#export-link').href = `/transactions/export?month=${state.month}`;
}

onSubmit('#tx-form', async (values, form) => {
    await api('POST', '/transactions', {
        type: values.type,
        date: values.date,
        amount: Number(values.amount),
        categoryId: Number(values.categoryId),
        accountId: values.accountId ? Number(values.accountId) : null,
        memo: values.memo || null
    });
    form.amount.value = '';
    form.memo.value = '';
    notice('거래를 적었습니다.');
    state.month = values.date.slice(0, 7);
    $('#month').value = state.month;
    state.page = 1;
    await renderLedger();
});

onSubmit('#search-form', async ({ q }) => {
    state.q = q.trim();
    state.page = 1;
    await renderLedger();
});

$('#prev').addEventListener('click', () => { state.page--; run(renderLedger); });
$('#next').addEventListener('click', () => { state.page++; run(renderLedger); });

// ---------- 예산 ----------
async function renderBudget() {
    const status = await api('GET', `/budgets/status?month=${state.month}`);
    $('#budget-title').textContent = `${monthLabel()} 예산`;
    $('#budget-list').innerHTML = status.items.length
        ? status.items.map(item => meter(item, true)).join('') +
          `<p class="small muted" style="margin-top:0.75rem">전체 ${won(status.total.spent)} / ${won(status.total.amount)} (${status.total.rate}%)</p>`
        : `<p class="muted">${monthLabel()} 예산이 없습니다. 위에서 정하거나 지난달 예산을 가져오세요.</p>`;
}

onSubmit('#budget-form', async (values, form) => {
    await api('POST', '/budgets', {
        month: state.month, categoryId: Number(values.categoryId), amount: Number(values.amount)
    });
    form.amount.value = '';
    notice('예산을 정했습니다.');
    await renderBudget();
});

$('#copy-budget').addEventListener('click', () => run(async () => {
    const result = await api('POST', '/budgets/copy-previous', { month: state.month });
    notice(`지난달 예산 ${result.copied}개를 가져왔습니다.`);
    await renderBudget();
}));

// ---------- 결제수단과 카테고리 ----------
async function renderManage() {
    await loadBasics();

    $('#account-table').innerHTML =
        '<thead><tr><th>이름</th><th>종류</th><th class="num">잔액</th><th></th></tr></thead><tbody>' +
        (state.accounts.map(a => `<tr>
            <td>${esc(a.name)}</td>
            <td class="muted">${ACCOUNT_TYPE[a.type]}</td>
            <td class="num ${a.balance < 0 ? 'expense' : ''}">${won(a.balance)}</td>
            <td class="num"><button class="link" data-delete-account="${a.id}">지우기</button></td>
        </tr>`).join('') || emptyRow('결제수단이 없습니다. 아래에서 통장이나 카드를 추가하세요.', 4)) +
        '</tbody>';

    $('#category-table').innerHTML =
        '<thead><tr><th>구분</th><th>이름</th><th></th></tr></thead><tbody>' +
        state.categories.map(c => `<tr>
            <td class="${c.type}">${c.type === 'income' ? '수입' : '지출'}</td>
            <td>${esc(c.name)}</td>
            <td class="num"><button class="link" data-delete-category="${c.id}">지우기</button></td>
        </tr>`).join('') +
        '</tbody>';
}

onSubmit('#account-form', async (values, form) => {
    await api('POST', '/accounts', {
        name: values.name.trim(), type: values.type, initialBalance: Number(values.initialBalance || 0)
    });
    form.reset();
    notice('결제수단을 추가했습니다.');
    await renderManage();
});

onSubmit('#transfer-form', async (values, form) => {
    await api('POST', '/accounts/transfer', {
        fromAccountId: Number(values.fromAccountId),
        toAccountId: Number(values.toAccountId),
        amount: Number(values.amount)
    });
    form.amount.value = '';
    notice('이체했습니다.');
    await renderManage();
});

onSubmit('#category-form', async (values, form) => {
    await api('POST', '/categories', { name: values.name.trim(), type: values.type });
    form.name.value = '';
    notice('카테고리를 추가했습니다.');
    await renderManage();
});

// ---------- 지우기 버튼 (표 안의 버튼은 한 곳에서 처리) ----------
const deletions = {
    deleteTx: { url: '/transactions/', done: '거래를 지웠습니다.', after: renderLedger },
    deleteBudget: { url: '/budgets/', done: '예산을 지웠습니다.', after: renderBudget },
    deleteAccount: { url: '/accounts/', done: '결제수단을 지웠습니다.', after: renderManage },
    deleteCategory: { url: '/categories/', done: '카테고리를 지웠습니다.', after: renderManage }
};

document.addEventListener('click', event => {
    const button = event.target.closest('button.link');
    if (!button) return;
    const key = Object.keys(deletions).find(name => button.dataset[name]);
    if (!key) return;

    const { url, done, after } = deletions[key];
    run(async () => {
        await api('DELETE', url + button.dataset[key]);
        notice(done);
        await after();
    });
});

// ---------- 시작: 이미 로그인되어 있으면 바로 가계부를 보여 준다 ----------
(async () => {
    try {
        state.user = await api('GET', '/auth/me');
        await showApp();
    } catch (error) {
        showAuth();
        if (error.status !== 401) notice(error.message, true);
    }
})();
