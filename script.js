(() => {
  const STORAGE_KEY = 'kanban.tasks.v1';
  const COLUMNS = ['todo', 'doing', 'done'];
  const LABELS = { todo: 'A Fazer', doing: 'Em Andamento', done: 'Concluído' };
  const EMPTY = {
    todo: 'Nenhuma tarefa por aqui. Adicione a primeira.',
    doing: 'Arraste uma tarefa para cá ao começar.',
    done: 'Tarefas finalizadas aparecem aqui.'
  };
  const TRASH = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 6h18M8 6V4h8v2M6 6l1 14h10l1-14M10 11v5M14 11v5"/></svg>';

  let tasks = load();
  let draggedId = null;

  const $ = (sel, root = document) => root.querySelector(sel);
  const modal = $('#modal');
  const form = $('#taskForm');
  const loginScreen = $('#loginScreen');
  const loginForm = $('#loginForm');
  const appHeader = $('#appHeader');
  const board = $('#board');

  /* Login (demonstração, sem autenticação real) */
  function showBoard(email) {
    loginScreen.hidden = true;
    appHeader.hidden = false;
    board.hidden = false;
    modal.hidden = false;
    $('#accountEmail').textContent = email;
  }
  /* Usuário de demonstração. A senha NÃO fica em texto puro:
     guardamos apenas o hash SHA-256 dela e comparamos com o hash do que foi digitado. */
  const DEMO_EMAIL = 'aluno@exemplo.com';
  const DEMO_PASSWORD_HASH = '1fe33a108ad71d7faef4e973f8aede19119af378e74a6343557f5943a61cbe7d';
  const passwordInput = $('#passwordInput');
  const togglePassword = $('#togglePassword');
  const loginError = $('#loginError');

  async function sha256(text) {
    const bytes = new TextEncoder().encode(text);
    const digest = await crypto.subtle.digest('SHA-256', bytes);
    return [...new Uint8Array(digest)].map(b => b.toString(16).padStart(2, '0')).join('');
  }
  function setLoginError(message) {
    loginError.textContent = message;
    loginError.hidden = !message;
  }
  function setPasswordVisible(visible) {
    passwordInput.type = visible ? 'text' : 'password';
    togglePassword.textContent = visible ? 'Ocultar' : 'Mostrar';
    togglePassword.setAttribute('aria-label', visible ? 'Ocultar senha' : 'Mostrar senha');
    togglePassword.setAttribute('aria-pressed', String(visible));
  }

  togglePassword.addEventListener('click', () => setPasswordVisible(passwordInput.type === 'password'));
  loginForm.addEventListener('input', () => setLoginError(''));

  loginForm.addEventListener('submit', async e => {
    e.preventDefault();
    if (!loginForm.reportValidity()) return;
    const email = $('#emailInput').value.trim().toLowerCase();
    let hash;
    try {
      hash = await sha256(passwordInput.value);
    } catch (err) {
      setLoginError('Não foi possível verificar a senha neste navegador.');
      return;
    }
    if (email !== DEMO_EMAIL || hash !== DEMO_PASSWORD_HASH) {
      setLoginError('E-mail ou senha incorretos. Confira os dados e tente de novo.');
      passwordInput.select();
      return;
    }
    setLoginError('');
    showBoard(email);
    loginForm.reset();
    setPasswordVisible(false);
  });
  $('#logoutBtn').addEventListener('click', () => {
    modal.close();
    modal.hidden = true;
    appHeader.hidden = true;
    board.hidden = true;
    loginScreen.hidden = false;
    $('#emailInput').focus();
  });

  function load() {
    try {
      const data = JSON.parse(localStorage.getItem(STORAGE_KEY));
      if (Array.isArray(data)) return data;
    } catch (e) { /* storage indisponível ou corrompido */ }
    return [
      { id: uid(), title: 'Bem-vindo ao seu quadro', desc: 'Arraste este card para outra coluna.', status: 'todo', createdAt: Date.now() }
    ];
  }
  function save() {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(tasks)); } catch (e) { /* ignora */ }
  }
  function uid() {
    return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  }

  /* Renderização */
  function render() {
    COLUMNS.forEach(status => {
      const list = $(`[data-list="${status}"]`);
      const items = tasks.filter(t => t.status === status);
      list.replaceChildren();
      if (!items.length) {
        const empty = document.createElement('div');
        empty.className = 'empty';
        empty.textContent = EMPTY[status];
        list.append(empty);
      }
      items.forEach(t => list.append(cardEl(t)));
      $(`[data-count="${status}"]`).textContent = items.length;
    });
  }

  function cardEl(t) {
    const el = document.createElement('article');
    el.className = 'card';
    el.draggable = true;
    el.dataset.id = t.id;

    const h = document.createElement('h3');
    h.textContent = t.title;
    el.append(h);

    if (t.desc) {
      const p = document.createElement('p');
      p.textContent = t.desc;
      el.append(p);
    }

    const del = document.createElement('button');
    del.type = 'button';
    del.className = 'btn-del';
    del.innerHTML = TRASH;
    del.setAttribute('aria-label', 'Excluir tarefa: ' + t.title);
    del.addEventListener('click', () => removeTask(t.id));
    el.append(del);

    const foot = document.createElement('div');
    foot.className = 'card-foot';
    const date = document.createElement('span');
    date.textContent = new Date(t.createdAt).toLocaleDateString('pt-BR', { day: '2-digit', month: 'short' });
    const move = document.createElement('div');
    move.className = 'move';
    const idx = COLUMNS.indexOf(t.status);
    [[-1, '←', 'Mover para '], [1, '→', 'Mover para ']].forEach(([dir, sym, txt]) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.textContent = sym;
      const target = COLUMNS[idx + dir];
      b.disabled = !target;
      if (target) b.setAttribute('aria-label', txt + LABELS[target]);
      b.addEventListener('click', () => moveTask(t.id, target));
      move.append(b);
    });
    foot.append(date, move);
    el.append(foot);

    el.addEventListener('dragstart', e => {
      draggedId = t.id;
      e.dataTransfer.effectAllowed = 'move';
      e.dataTransfer.setData('text/plain', t.id);
      requestAnimationFrame(() => el.classList.add('dragging'));
    });
    el.addEventListener('dragend', () => {
      draggedId = null;
      el.classList.remove('dragging');
      document.querySelectorAll('.drag-over').forEach(c => c.classList.remove('drag-over'));
    });
    return el;
  }

  /* Ações */
  function addTask(title, desc) {
    tasks.push({ id: uid(), title, desc, status: 'todo', createdAt: Date.now() });
    save(); render();
  }
  function removeTask(id) {
    tasks = tasks.filter(t => t.id !== id);
    save(); render();
  }
  function moveTask(id, status, beforeId = null) {
    const task = tasks.find(t => t.id === id);
    if (!task || !status) return;
    tasks = tasks.filter(t => t.id !== id);
    task.status = status;
    const at = beforeId ? tasks.findIndex(t => t.id === beforeId) : -1;
    if (at >= 0) tasks.splice(at, 0, task); else tasks.push(task);
    save(); render();
  }

  /* Drag and drop nas colunas */
  function cardAfterCursor(list, y) {
    const cards = [...list.querySelectorAll('.card:not(.dragging)')];
    return cards.find(c => {
      const box = c.getBoundingClientRect();
      return y < box.top + box.height / 2;
    });
  }
  document.querySelectorAll('.column').forEach(col => {
    const list = $('.cards', col);
    col.addEventListener('dragover', e => {
      if (!draggedId) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';
      col.classList.add('drag-over');
    });
    col.addEventListener('dragleave', e => {
      if (!col.contains(e.relatedTarget)) col.classList.remove('drag-over');
    });
    col.addEventListener('drop', e => {
      e.preventDefault();
      col.classList.remove('drag-over');
      if (!draggedId) return;
      const next = cardAfterCursor(list, e.clientY);
      moveTask(draggedId, col.dataset.status, next ? next.dataset.id : null);
    });
  });

  /* Modal */
  $('#openModal').addEventListener('click', () => {
    form.reset();
    modal.showModal();
    $('#titleInput').focus();
  });
  $('#cancelBtn').addEventListener('click', () => modal.close());
  modal.addEventListener('click', e => { if (e.target === modal) modal.close(); });
  form.addEventListener('submit', e => {
    e.preventDefault();
    const title = $('#titleInput').value.trim();
    if (!title) return;
    addTask(title, $('#descInput').value.trim());
    modal.close();
  });

  render();
})();
