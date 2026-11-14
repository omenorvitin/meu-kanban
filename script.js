import { initializeApp } from "https://www.gstatic.com/firebasejs/13.2.0/firebase-app.js";
import {
  getAuth, onAuthStateChanged, createUserWithEmailAndPassword,
  signInWithEmailAndPassword, signOut
} from "https://www.gstatic.com/firebasejs/13.2.0/firebase-auth.js";
import {
  getFirestore, doc, collection, collectionGroup, getDoc, getDocs, setDoc,
  deleteDoc, query, where, writeBatch, serverTimestamp, onSnapshot
} from "https://www.gstatic.com/firebasejs/13.2.0/firebase-firestore.js";
import { firebaseConfig } from "./firebase-config.js";

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);
const APP_BASE = new URL(".", import.meta.url).pathname;
const COLUMNS = ["todo", "doing", "done"];
const DEFAULT_COLUMNS = { todo: "A Fazer", doing: "Em Andamento", done: "Concluído" };
const DEFAULT_WIP = { todo: 0, doing: 0, done: 0 };
const EMPTY = {
  todo: "Nenhuma tarefa por aqui. Adicione a primeira.",
  doing: "Arraste uma tarefa para cá ao começar.",
  done: "Tarefas finalizadas aparecem aqui."
};
const TRASH = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 6h18M8 6V4h8v2M6 6l1 14h10l1-14M10 11v5M14 11v5"/></svg>';
const AUTH_ERRORS = {
  "auth/invalid-credential": "E-mail ou senha incorretos.",
  "auth/user-not-found": "E-mail ou senha incorretos.",
  "auth/wrong-password": "E-mail ou senha incorretos.",
  "auth/email-already-in-use": "Este e-mail já tem uma conta. Tente entrar.",
  "auth/weak-password": "A senha é fraca. Use pelo menos 8 caracteres.",
  "auth/invalid-email": "Digite um e-mail válido.",
  "auth/too-many-requests": "Muitas tentativas. Aguarde um pouco e tente de novo.",
  "auth/network-request-failed": "Sem conexão. Verifique a internet e tente de novo.",
  "auth/operation-not-allowed": "O login por e-mail e senha não está ativado no Firebase."
};

let tasks = [];
let currentUser = null;
let currentBoard = null;
let boards = [];
let members = [];
let currentRole = "VIEWER";
let boardReady = false;
let justSignedUp = false;
let authMode = "login";
let draggedId = null;
let statusTimer;
let unsubscribeBoard = null;

const $ = (sel, root = document) => root.querySelector(sel);
const authLoading = $("#authLoading");
const loginScreen = $("#loginScreen");
const loginForm = $("#loginForm");
const loginMessage = $("#loginMessage");
const emailInput = $("#emailInput");
const passwordInput = $("#passwordInput");
const confirmPasswordInput = $("#confirmPasswordInput");
const confirmPasswordField = $("#confirmPasswordField");
const togglePassword = $("#togglePassword");
const loginSubmit = $("#loginSubmit");
const appHeader = $("#appHeader");
const boardStatus = $("#boardStatus");
const board = $("#board");
const taskPage = $("#taskPage");
const modal = $("#modal");
const form = $("#taskForm");
const shareModal = $("#shareModal");
const boardConfigModal = $("#boardConfigModal");

function uid() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

function escapeRoute(value) {
  return encodeURIComponent(value);
}

function taskRoute(task) {
  return `${APP_BASE}tasks/${escapeRoute(`${currentBoard.id}~${task.id}`)}`;
}

function taskEntryUrl(task) {
  return `${APP_BASE}index.html?route=${encodeURIComponent(taskRoute(task))}`;
}

function routeTaskId() {
  const routeFromQuery = new URLSearchParams(location.search).get("route");
  if (routeFromQuery && (routeFromQuery === APP_BASE || routeFromQuery.startsWith(`${APP_BASE}tasks/`))) {
    history.replaceState(null, "", routeFromQuery);
  }
  const prefix = `${APP_BASE}tasks/`;
  if (!location.pathname.startsWith(prefix)) return null;
  try {
    return decodeURIComponent(location.pathname.slice(prefix.length));
  } catch (err) {
    console.error("URL de tarefa inválida:", err);
    return null;
  }
}

/* Telas e mensagens */
function showLogin() {
  if (modal.open) modal.close();
  if (shareModal.open) shareModal.close();
  if (boardConfigModal.open) boardConfigModal.close();
  authLoading.hidden = true;
  appHeader.hidden = true;
  board.hidden = true;
  taskPage.hidden = true;
  modal.hidden = true;
  loginScreen.hidden = false;
  emailInput.focus();
}

function showBoard(email) {
  authLoading.hidden = true;
  loginScreen.hidden = true;
  appHeader.hidden = false;
  board.hidden = false;
  taskPage.hidden = true;
  modal.hidden = false;
  $("#accountEmail").textContent = email || "";
}

function showTaskPage() {
  authLoading.hidden = true;
  loginScreen.hidden = true;
  appHeader.hidden = true;
  board.hidden = true;
  taskPage.hidden = false;
}

function showMessage(text, ok = false) {
  loginMessage.textContent = text;
  loginMessage.classList.toggle("login-ok", ok);
  loginMessage.hidden = !text;
}

function showStatus(text, isError = false) {
  boardStatus.textContent = text;
  boardStatus.classList.toggle("is-error", isError);
  boardStatus.hidden = false;
  clearTimeout(statusTimer);
  if (!isError) statusTimer = setTimeout(() => { boardStatus.hidden = true; }, 4000);
}

function setPasswordVisible(visible) {
  const type = visible ? "text" : "password";
  passwordInput.type = type;
  confirmPasswordInput.type = type;
  togglePassword.textContent = visible ? "Ocultar" : "Mostrar";
  togglePassword.setAttribute("aria-label", visible ? "Ocultar senha" : "Mostrar senha");
  togglePassword.setAttribute("aria-pressed", String(visible));
}

function setAuthMode(mode) {
  authMode = mode;
  const isSignup = mode === "signup";
  $("#loginTitle").textContent = isSignup ? "Crie sua conta" : "Entre no seu quadro";
  $("#loginIntro").textContent = isSignup
    ? "Cadastre seu e-mail e escolha uma senha."
    : "Informe seu e-mail e sua senha para continuar.";
  loginSubmit.textContent = isSignup ? "Criar conta" : "Entrar";
  $("#switchPrompt").textContent = isSignup ? "Já tem uma conta?" : "Ainda não tem uma conta?";
  $("#switchAuthMode").textContent = isSignup ? "Entrar" : "Criar conta";
  confirmPasswordField.hidden = !isSignup;
  confirmPasswordInput.required = isSignup;
  confirmPasswordInput.value = "";
  passwordInput.autocomplete = isSignup ? "new-password" : "current-password";
  showMessage("");
}

function normalizeBoard(data, id) {
  return {
    ...data,
    id,
    name: data.name || "Meu Quadro",
    ownerId: data.ownerId || id,
    ownerEmail: data.ownerEmail || "",
    tasks: Array.isArray(data.tasks) ? data.tasks : [],
    columns: { ...DEFAULT_COLUMNS, ...(data.columns || {}) },
    wipLimits: { ...DEFAULT_WIP, ...(data.wipLimits || {}) }
  };
}

async function acceptInvitations(user) {
  const email = (user.email || "").toLowerCase();
  if (!email) return 0;
  const invites = await getDocs(query(collection(db, "invitations"), where("email", "==", email)));
  if (invites.empty) return 0;
  const batch = writeBatch(db);
  const grouped = new Map();
  invites.docs.forEach(invite => {
    const data = invite.data();
    const group = grouped.get(data.boardId) || [];
    group.push({ id: invite.id, ref: invite.ref, data });
    grouped.set(data.boardId, group);
  });
  let joinedCount = 0;
  for (const [boardId, boardInvites] of grouped) {
    const memberRef = doc(db, "boards", boardId, "members", user.uid);
    const memberSnap = await getDoc(memberRef);
    if (!memberSnap.exists()) {
      const invite = boardInvites[boardInvites.length - 1];
      batch.set(memberRef, {
        userId: user.uid,
        email,
        role: invite.data.role,
        inviteId: invite.id,
        joinedAt: serverTimestamp()
      });
      joinedCount++;
    }
    boardInvites.forEach(invite => batch.delete(invite.ref));
  }
  try {
    await batch.commit();
  } catch (err) {
    console.error("Erro ao aceitar convites:", err);
    throw err;
  }
  return joinedCount;
}

async function loadBoardList(user) {
  const ownedSnap = await getDocs(query(collection(db, "boards"), where("ownerId", "==", user.uid)));
  const owned = ownedSnap.docs.map(snap => normalizeBoard(snap.data(), snap.id));

  const legacyRef = doc(db, "boards", user.uid);
  const legacySnap = await getDoc(legacyRef);
  if (legacySnap.exists() && !owned.some(item => item.id === legacySnap.id)) {
    const legacy = normalizeBoard(legacySnap.data(), legacySnap.id);
    await setDoc(legacyRef, {
      ownerId: user.uid,
      ownerEmail: user.email || "",
      name: legacy.name,
      columns: legacy.columns,
      wipLimits: legacy.wipLimits,
      updatedAt: serverTimestamp()
    }, { merge: true });
    owned.push(legacy);
  }

  const memberSnap = await getDocs(query(collectionGroup(db, "members"), where("userId", "==", user.uid)));
  const sharedIds = memberSnap.docs.map(snap => ({
    id: snap.ref.parent.parent.id,
    role: snap.data().role
  }));
  const shared = [];
  for (const membership of sharedIds) {
    if (owned.some(item => item.id === membership.id)) continue;
    const snap = await getDoc(doc(db, "boards", membership.id));
    if (snap.exists()) shared.push({ ...normalizeBoard(snap.data(), snap.id), role: membership.role });
  }

  if (!owned.length && !shared.length) {
    const id = user.uid;
    const initial = [{
      id: uid(),
      title: "Bem-vindo ao seu quadro",
      desc: "Abra esta tarefa para ver detalhes e colaborar.",
      status: "todo",
      createdAt: Date.now(),
      checklist: [],
      comments: [],
      activity: []
    }];
    const initialBoard = {
      ownerId: user.uid,
      ownerEmail: user.email || "",
      name: "Meu Quadro",
      tasks: initial,
      columns: DEFAULT_COLUMNS,
      wipLimits: DEFAULT_WIP,
      updatedAt: serverTimestamp()
    };
    await setDoc(doc(db, "boards", id), initialBoard);
    owned.push(normalizeBoard(initialBoard, id));
  }
  return { owned, shared };
}

async function loadSelectedBoard(boardInfo) {
  if (unsubscribeBoard) unsubscribeBoard();
  unsubscribeBoard = null;
  const snap = await getDoc(doc(db, "boards", boardInfo.id));
  if (!snap.exists()) throw new Error("O quadro não existe mais ou seu acesso foi removido.");
  currentBoard = normalizeBoard(snap.data(), snap.id);
  currentRole = currentBoard.ownerId === currentUser.uid ? "OWNER" : boardInfo.role;
  tasks = currentBoard.tasks;
  if (!currentBoard.ownerEmail && currentRole === "OWNER") {
    currentBoard.ownerEmail = currentUser.email || "";
    await setDoc(doc(db, "boards", currentBoard.id), { ownerEmail: currentBoard.ownerEmail }, { merge: true });
  }
  const memberSnap = await getDocs(collection(db, "boards", currentBoard.id, "members"));
  members = [
    { id: currentBoard.ownerId, email: currentBoard.ownerEmail || "Dono do quadro", role: "OWNER" },
    ...memberSnap.docs.map(item => ({ id: item.id, ...item.data() }))
  ];
  boardReady = true;
  updateBoardControls();
  render();
  unsubscribeBoard = onSnapshot(doc(db, "boards", currentBoard.id), updated => {
    if (!updated.exists() || currentBoard?.id !== updated.id) return;
    currentBoard = normalizeBoard(updated.data(), updated.id);
    tasks = currentBoard.tasks;
    updateBoardControls();
    render();
    if (!taskPage.hidden) {
      const active = tasks.find(item => item.id === activeTaskId());
      if (active) renderTaskDetail(active);
    }
  }, err => {
    console.error("Erro ao sincronizar o quadro:", err);
    showStatus("A sincronização do quadro falhou. Recarregue a página.", true);
  });
}

async function saveBoard(changes = {}) {
  if (!currentUser || !currentBoard || !boardReady || !canEdit()) return;
  try {
    await setDoc(doc(db, "boards", currentBoard.id), {
      ...changes,
      ownerId: currentBoard.ownerId,
      updatedAt: serverTimestamp()
    }, { merge: true });
    Object.assign(currentBoard, changes);
    if (changes.tasks) tasks = changes.tasks;
  } catch (err) {
    console.error("Erro ao salvar o quadro:", err);
    showStatus("Não foi possível salvar. Verifique sua permissão e tente de novo.", true);
  }
}

function canEdit() {
  return currentRole === "OWNER" || currentRole === "EDITOR";
}

function renderBoardPicker(owned, shared) {
  boards = [
    ...owned.map(item => ({ ...item, role: "OWNER", group: "Meus quadros" })),
    ...shared.map(item => ({ ...item, group: "Compartilhados comigo" }))
  ];
  const picker = $("#boardPicker");
  picker.replaceChildren();
  [["Meus quadros", owned], ["Compartilhados comigo", shared]].forEach(([label, items]) => {
    if (!items.length) return;
    const group = document.createElement("optgroup");
    group.label = label;
    items.forEach(item => {
      const option = document.createElement("option");
      option.value = item.id;
      option.textContent = item.name;
      group.append(option);
    });
    picker.append(group);
  });
}

function updateBoardControls() {
  $("#boardTitle").textContent = currentBoard.name;
  $("#boardPicker").value = currentBoard.id;
  $("#shareBoardBtn").hidden = currentRole !== "OWNER";
  $("#newBoardBtn").hidden = false;
  $("#configureBoardBtn").hidden = !canEdit();
  $("#openModal").hidden = !canEdit();
  $("#accountEmail").textContent = currentUser.email || "";
}

/* Renderização do quadro */
function render() {
  if (!currentBoard) return;
  COLUMNS.forEach(status => {
    const list = $(`[data-list="${status}"]`);
    const items = tasks.filter(task => task.status === status);
    list.replaceChildren();
    $(`#h-${status}`).textContent = currentBoard.columns[status] || DEFAULT_COLUMNS[status];
    const limit = Number(currentBoard.wipLimits[status]) || 0;
    const wip = $(`[data-wip="${status}"]`);
    wip.textContent = limit ? `WIP ${items.length}/${limit}` : "";
    wip.classList.toggle("wip-over", Boolean(limit && items.length > limit));
    if (!items.length) {
      const empty = document.createElement("div");
      empty.className = "empty";
      empty.textContent = EMPTY[status];
      list.append(empty);
    }
    items.forEach(task => list.append(cardEl(task)));
    $(`[data-count="${status}"]`).textContent = items.length;
  });
}

function cardEl(task) {
  const el = document.createElement("article");
  el.className = "card";
  if (!canEdit()) el.classList.add("is-readonly");
  el.dataset.id = task.id;
  el.draggable = canEdit();

  const title = document.createElement("h3");
  title.textContent = task.title;
  el.append(title);
  const open = document.createElement("a");
  open.className = "card-open";
  open.href = taskEntryUrl(task);
  open.textContent = "Abrir tarefa";
  open.target = "_blank";
  open.rel = "noopener";
  el.append(open);

  if (task.desc) {
    const desc = document.createElement("p");
    desc.textContent = task.desc;
    el.append(desc);
  }
  if (task.priority) {
    const priority = document.createElement("span");
    priority.className = `priority priority-${task.priority}`;
    priority.textContent = { low: "Baixa", medium: "Média", high: "Alta" }[task.priority] || "";
    el.append(priority);
  }
  if (Array.isArray(task.labels) && task.labels.length) {
    const labels = document.createElement("div");
    labels.className = "card-labels";
    task.labels.forEach(label => {
      const chip = document.createElement("span");
      chip.textContent = label;
      labels.append(chip);
    });
    el.append(labels);
  }
  if (Array.isArray(task.checklist) && task.checklist.length) {
    const progress = document.createElement("p");
    const completed = task.checklist.filter(item => item.done).length;
    progress.textContent = `Checklist: ${completed}/${task.checklist.length}`;
    el.append(progress);
  }
  if (task.inBacklog) {
    const backlog = document.createElement("span");
    backlog.className = "priority priority-medium";
    backlog.textContent = "Backlog";
    el.append(backlog);
  }
  const del = document.createElement("button");
  del.type = "button";
  del.className = "btn-del";
  del.innerHTML = TRASH;
  del.setAttribute("aria-label", "Excluir tarefa: " + task.title);
  del.hidden = !canEdit();
  del.addEventListener("click", () => removeTask(task.id));
  el.append(del);

  const foot = document.createElement("div");
  foot.className = "card-foot";
  const date = document.createElement("span");
  date.textContent = task.dueDate
    ? `Prazo: ${new Date(`${task.dueDate}T00:00:00`).toLocaleDateString("pt-BR")}`
    : new Date(task.createdAt || Date.now()).toLocaleDateString("pt-BR", { day: "2-digit", month: "short" });
  const move = document.createElement("div");
  move.className = "move";
  const index = COLUMNS.indexOf(task.status);
  [[-1, "←"], [1, "→"]].forEach(([direction, symbol]) => {
    const button = document.createElement("button");
    button.type = "button";
    button.textContent = symbol;
    const target = COLUMNS[index + direction];
    button.disabled = !target || !canEdit();
    if (target) button.setAttribute("aria-label", `Mover para ${currentBoard.columns[target]}`);
    button.addEventListener("click", () => moveTask(task.id, target));
    move.append(button);
  });
  foot.append(date, move);
  el.append(foot);

  if (canEdit()) {
    el.addEventListener("dragstart", event => {
      draggedId = task.id;
      event.dataTransfer.effectAllowed = "move";
      event.dataTransfer.setData("text/plain", task.id);
      requestAnimationFrame(() => el.classList.add("dragging"));
    });
  }
  el.addEventListener("dragend", () => {
    draggedId = null;
    el.classList.remove("dragging");
    document.querySelectorAll(".drag-over").forEach(column => column.classList.remove("drag-over"));
  });
  return el;
}

/* Ações e histórico */
function addActivity(task, text) {
  task.activity = Array.isArray(task.activity) ? task.activity : [];
  task.activity.unshift({ text, author: currentUser.email || "Usuário", at: Date.now() });
  task.activity = task.activity.slice(0, 100);
}

function addTask(title, desc) {
  if (!canEdit()) return false;
  const limit = Number(currentBoard.wipLimits.todo) || 0;
  if (limit && tasks.filter(task => task.status === "todo").length >= limit) {
    showStatus(`A coluna ${currentBoard.columns.todo} atingiu o limite WIP.`, true);
    return false;
  }
  const task = {
    id: uid(), title, desc, status: "todo", createdAt: Date.now(),
    checklist: [], comments: [], activity: []
  };
  addActivity(task, "criou a tarefa");
  tasks.push(task);
  saveBoard({ tasks });
  render();
  return true;
}

function removeTask(id) {
  if (!canEdit()) return;
  tasks = tasks.filter(task => task.id !== id);
  saveBoard({ tasks });
  render();
}

function moveTask(id, status, beforeId = null) {
  if (!canEdit()) return;
  const task = tasks.find(item => item.id === id);
  if (!task || !status) return;
  const oldStatus = task.status;
  const limit = Number(currentBoard.wipLimits[status]) || 0;
  const targetCount = tasks.filter(item => item.status === status && item.id !== id).length;
  if (oldStatus !== status && limit && targetCount >= limit) {
    showStatus(`A coluna ${currentBoard.columns[status]} atingiu o limite WIP.`, true);
    return;
  }
  tasks = tasks.filter(item => item.id !== id);
  task.status = status;
  const index = beforeId ? tasks.findIndex(item => item.id === beforeId) : -1;
  if (index >= 0) tasks.splice(index, 0, task);
  else tasks.push(task);
  if (oldStatus !== status) addActivity(task, `moveu a tarefa para ${currentBoard.columns[status]}`);
  saveBoard({ tasks });
  render();
}

document.querySelectorAll(".column").forEach(column => {
  const list = $(".cards", column);
  column.addEventListener("dragover", event => {
    if (!draggedId || !canEdit()) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = "move";
    column.classList.add("drag-over");
  });
  column.addEventListener("dragleave", event => {
    if (!column.contains(event.relatedTarget)) column.classList.remove("drag-over");
  });
  column.addEventListener("drop", event => {
    event.preventDefault();
    column.classList.remove("drag-over");
    if (!draggedId || !canEdit()) return;
    const next = [...list.querySelectorAll(".card:not(.dragging)")].find(card => {
      const box = card.getBoundingClientRect();
      return event.clientY < box.top + box.height / 2;
    });
    moveTask(draggedId, column.dataset.status, next ? next.dataset.id : null);
  });
});

$("#openModal").addEventListener("click", () => {
  form.reset();
  modal.showModal();
  $("#titleInput").focus();
});
$("#cancelBtn").addEventListener("click", () => modal.close());
modal.addEventListener("click", event => { if (event.target === modal) modal.close(); });
form.addEventListener("submit", event => {
  event.preventDefault();
  const title = $("#titleInput").value.trim();
  if (!title) return;
  if (addTask(title, $("#descInput").value.trim())) modal.close();
});

/* Detalhe da tarefa */
function updateTask(task, message = "atualizou a tarefa") {
  if (!task || !canEdit()) return;
  addActivity(task, message);
  saveBoard({ tasks });
  render();
  renderTaskDetail(task);
}

function renderTaskDetail(task) {
  $("#taskBoardName").textContent = `${currentBoard.name} · ${currentBoard.columns[task.status] || ""}`;
  $("#detailTitle").value = task.title || "";
  $("#detailDesc").value = task.desc || "";
  $("#dueDateInput").value = task.dueDate || "";
  $("#priorityInput").value = task.priority || "low";
  $("#labelsInput").value = (task.labels || []).join(", ");
  $("#sprintInput").value = task.sprint || "";
  $("#pointsInput").value = task.storyPoints ?? "";
  $("#backlogInput").checked = Boolean(task.inBacklog);
  $("#acceptanceInput").value = task.acceptanceCriteria || "";
  $("#dodInput").value = task.definitionOfDone || "";
  ["detailTitle", "detailDesc", "dueDateInput", "priorityInput", "labelsInput", "sprintInput", "pointsInput", "backlogInput", "acceptanceInput", "dodInput"]
    .forEach(id => { $(`#${id}`).disabled = !canEdit(); });

  const assignee = $("#assigneeInput");
  assignee.replaceChildren();
  const noAssignee = document.createElement("option");
  noAssignee.value = "";
  noAssignee.textContent = "Sem responsável";
  assignee.append(noAssignee);
  members.forEach(member => {
    const option = document.createElement("option");
    option.value = member.id;
    option.textContent = member.email || member.id;
    assignee.append(option);
  });
  assignee.value = task.assigneeId || "";
  assignee.disabled = !canEdit();

  const checklist = $("#checklist");
  checklist.replaceChildren();
  (task.checklist || []).forEach(item => {
    const li = document.createElement("li");
    const checkbox = document.createElement("input");
    checkbox.type = "checkbox";
    checkbox.checked = Boolean(item.done);
    checkbox.disabled = !canEdit();
    checkbox.addEventListener("change", () => {
      item.done = checkbox.checked;
      updateTask(task, checkbox.checked ? "concluiu uma subtarefa" : "reabriu uma subtarefa");
    });
    const text = document.createElement("span");
    text.textContent = item.text;
    text.classList.toggle("is-done", Boolean(item.done));
    li.append(checkbox, text);
    if (canEdit()) {
      const remove = document.createElement("button");
      remove.type = "button";
      remove.className = "btn-ghost";
      remove.textContent = "Remover";
      remove.addEventListener("click", () => {
        task.checklist = task.checklist.filter(entry => entry.id !== item.id);
        updateTask(task, "removeu uma subtarefa");
      });
      li.append(remove);
    }
    checklist.append(li);
  });
  $("#checklistInput").disabled = !canEdit();
  $("#checklistForm").querySelector("button").disabled = !canEdit();
  $("#commentInput").disabled = !canEdit();
  $("#commentForm").querySelector("button").disabled = !canEdit();

  const comments = $("#comments");
  comments.replaceChildren();
  (task.comments || []).slice().reverse().forEach(comment => {
    const article = document.createElement("article");
    article.className = "comment";
    const meta = document.createElement("small");
    meta.textContent = `${comment.author || "Usuário"} · ${new Date(comment.at || Date.now()).toLocaleString("pt-BR")}`;
    const text = document.createElement("p");
    text.textContent = comment.text;
    article.append(meta, text);
    comments.append(article);
  });

  const activityList = $("#activityList");
  activityList.replaceChildren();
  (task.activity || []).forEach(entry => {
    const li = document.createElement("li");
    li.textContent = `${entry.author || "Usuário"} ${entry.text} · ${new Date(entry.at || Date.now()).toLocaleString("pt-BR")}`;
    activityList.append(li);
  });
}

const detailFields = {
  detailTitle: "title",
  detailDesc: "desc",
  dueDateInput: "dueDate",
  priorityInput: "priority",
  sprintInput: "sprint",
  pointsInput: "storyPoints",
  acceptanceInput: "acceptanceCriteria",
  dodInput: "definitionOfDone"
};
Object.entries(detailFields).forEach(([inputId, key]) => {
  $(`#${inputId}`).addEventListener("change", () => {
    const task = currentBoard && tasks.find(item => item.id === activeTaskId());
    if (!task || !canEdit()) return;
    task[key] = key === "storyPoints" ? Number($(`#${inputId}`).value) || 0 : $(`#${inputId}`).value.trim();
    updateTask(task);
  });
});
$("#labelsInput").addEventListener("change", () => {
  const task = currentBoard && tasks.find(item => item.id === activeTaskId());
  if (!task || !canEdit()) return;
  task.labels = $("#labelsInput").value.split(",").map(label => label.trim()).filter(Boolean).slice(0, 10);
  updateTask(task, "alterou as labels");
});
$("#assigneeInput").addEventListener("change", () => {
  const task = currentBoard && tasks.find(item => item.id === activeTaskId());
  if (!task || !canEdit()) return;
  task.assigneeId = $("#assigneeInput").value || "";
  updateTask(task, "alterou o responsável");
});
$("#backlogInput").addEventListener("change", () => {
  const task = currentBoard && tasks.find(item => item.id === activeTaskId());
  if (!task || !canEdit()) return;
  task.inBacklog = $("#backlogInput").checked;
  updateTask(task, task.inBacklog ? "moveu a tarefa para o backlog" : "removeu a tarefa do backlog");
});
$("#checklistForm").addEventListener("submit", event => {
  event.preventDefault();
  const task = tasks.find(item => item.id === activeTaskId());
  const text = $("#checklistInput").value.trim();
  if (!task || !text || !canEdit()) return;
  task.checklist = [...(task.checklist || []), { id: uid(), text, done: false }];
  $("#checklistInput").value = "";
  updateTask(task, "adicionou uma subtarefa");
});
$("#commentForm").addEventListener("submit", event => {
  event.preventDefault();
  const task = tasks.find(item => item.id === activeTaskId());
  const text = $("#commentInput").value.trim();
  if (!task || !text || !canEdit()) return;
  task.comments = [...(task.comments || []), {
    id: uid(), author: currentUser.email || "Usuário", userId: currentUser.uid, at: Date.now(), text
  }];
  $("#commentInput").value = "";
  updateTask(task, "comentou na tarefa");
});

function activeTaskId() {
  const composite = routeTaskId();
  if (!composite) return null;
  const separator = composite.indexOf("~");
  return separator < 0 ? composite : composite.slice(separator + 1);
}

async function renderRoute() {
  if (!currentUser || !boardReady) return;
  const composite = routeTaskId();
  if (!composite) {
    if (currentBoard) showBoard(currentUser.email);
    return;
  }
  const separator = composite.indexOf("~");
  const boardId = separator < 0 ? currentBoard?.id : composite.slice(0, separator);
  const taskId = separator < 0 ? composite : composite.slice(separator + 1);
  let boardInfo = boards.find(item => item.id === boardId);
  if (!boardInfo) {
    try {
      const snap = await getDoc(doc(db, "boards", boardId));
      if (!snap.exists()) throw new Error("Quadro não encontrado.");
      const data = snap.data();
      const membership = await getDoc(doc(db, "boards", boardId, "members", currentUser.uid));
      if (data.ownerId !== currentUser.uid && !membership.exists()) throw new Error("Você não tem acesso a este quadro.");
      boardInfo = { ...normalizeBoard(data, snap.id), role: data.ownerId === currentUser.uid ? "OWNER" : membership.data().role };
      boards.push(boardInfo);
    } catch (err) {
      console.error("Erro ao abrir tarefa compartilhada:", err);
      showStatus("Não foi possível abrir esta tarefa. Verifique o link e suas permissões.", true);
      history.replaceState(null, "", APP_BASE);
      showBoard(currentUser.email);
      return;
    }
  }
  if (currentBoard?.id !== boardId) await loadSelectedBoard(boardInfo);
  const task = tasks.find(item => item.id === taskId);
  if (!task) {
    showStatus("Esta tarefa não existe mais neste quadro.", true);
    history.replaceState(null, "", APP_BASE);
    showBoard(currentUser.email);
    return;
  }
  renderTaskDetail(task);
  showTaskPage();
}

window.addEventListener("popstate", () => { renderRoute().catch(err => showStatus(err.message, true)); });
$("#backToBoard").addEventListener("click", () => {
  history.pushState(null, "", APP_BASE);
  renderRoute();
});

/* Compartilhamento */
async function renderMembers() {
  const list = $("#memberList");
  list.replaceChildren();
  if (!currentBoard || currentRole !== "OWNER") return;
  const memberSnap = await getDocs(collection(db, "boards", currentBoard.id, "members"));
  members = [
    { id: currentBoard.ownerId, email: currentBoard.ownerEmail || "Dono do quadro", role: "OWNER" },
    ...memberSnap.docs.map(item => ({ id: item.id, ...item.data() }))
  ];
  if (members.length === 1) {
    const empty = document.createElement("li");
    empty.textContent = "Ainda não há membros convidados.";
    list.append(empty);
  }
  members.forEach(member => {
    const li = document.createElement("li");
    const label = document.createElement("span");
    label.textContent = `${member.email || member.id} — ${member.role === "OWNER" ? "Dono" : member.role === "EDITOR" ? "Editor" : "Leitor"}`;
    const remove = document.createElement("button");
    remove.type = "button";
    remove.className = "btn-ghost";
    remove.textContent = "Remover acesso";
    remove.addEventListener("click", async () => {
      try {
        await deleteDoc(doc(db, "boards", currentBoard.id, "members", member.id));
        members = members.filter(item => item.id !== member.id);
        renderMembers();
        showStatus("Acesso removido.");
      } catch (err) {
        console.error("Erro ao remover membro:", err);
        showStatus("Não foi possível remover o acesso.", true);
      }
    });
    remove.hidden = member.role === "OWNER";
    li.append(label, remove);
    list.append(li);
  });
}

$("#shareBoardBtn").addEventListener("click", async () => {
  $("#shareMessage").hidden = true;
  $("#shareForm").reset();
  try {
    await renderMembers();
    shareModal.hidden = false;
    shareModal.showModal();
  } catch (err) {
    console.error("Erro ao carregar membros:", err);
    showStatus("Não foi possível carregar os membros do quadro.", true);
  }
});
$("#shareForm").addEventListener("submit", async event => {
  event.preventDefault();
  const email = $("#inviteEmail").value.trim().toLowerCase();
  if (!email || email === (currentUser.email || "").toLowerCase()) {
    $("#shareMessage").textContent = "Informe o e-mail de outra pessoa.";
    $("#shareMessage").hidden = false;
    return;
  }
  try {
    const existing = members.find(member => (member.email || "").toLowerCase() === email);
    if (existing) throw new Error("Este usuário já é membro do quadro.");
    const inviteRef = doc(collection(db, "invitations"));
    await setDoc(inviteRef, {
      boardId: currentBoard.id,
      email,
      role: $("#inviteRole").value,
      createdBy: currentUser.uid,
      createdAt: serverTimestamp()
    });
    $("#shareMessage").textContent = "Convite enviado. O acesso será ativado quando a pessoa entrar com este e-mail.";
    $("#shareMessage").classList.add("login-ok");
    $("#shareMessage").hidden = false;
    $("#inviteEmail").value = "";
  } catch (err) {
    console.error("Erro ao convidar usuário:", err);
    $("#shareMessage").classList.remove("login-ok");
    $("#shareMessage").textContent = err.message || "Não foi possível enviar o convite. Verifique as regras do Firestore.";
    $("#shareMessage").hidden = false;
  }
});

/* Configurações do quadro */
$("#configureBoardBtn").addEventListener("click", () => {
  COLUMNS.forEach(status => {
    $(`#${status}Name`).value = currentBoard.columns[status];
    $(`#${status}Wip`).value = currentBoard.wipLimits[status] || 0;
  });
  boardConfigModal.hidden = false;
  boardConfigModal.showModal();
});
$("#boardConfigForm").addEventListener("submit", event => {
  event.preventDefault();
  const columns = {};
  const wipLimits = {};
  COLUMNS.forEach(status => {
    columns[status] = $(`#${status}Name`).value.trim();
    wipLimits[status] = Number($(`#${status}Wip`).value) || 0;
  });
  saveBoard({ columns, wipLimits });
  boardConfigModal.close();
  render();
});
document.querySelectorAll("[data-close-dialog]").forEach(button => {
  button.addEventListener("click", () => $(`#${button.dataset.closeDialog}`).close());
});

$("#boardPicker").addEventListener("change", async event => {
  const selected = boards.find(item => item.id === event.target.value);
  if (!selected) return;
  boardReady = false;
  try {
    await loadSelectedBoard(selected);
    history.replaceState(null, "", APP_BASE);
    showBoard(currentUser.email);
  } catch (err) {
    console.error("Erro ao trocar de quadro:", err);
    showStatus("Não foi possível carregar o quadro selecionado.", true);
  }
});

$("#newBoardBtn").addEventListener("click", async () => {
  const name = window.prompt("Nome do novo quadro:");
  if (!name || !name.trim()) return;
  const id = uid();
  const newBoard = {
    ownerId: currentUser.uid,
    ownerEmail: currentUser.email || "",
    name: name.trim().slice(0, 60),
    tasks: [],
    columns: DEFAULT_COLUMNS,
    wipLimits: DEFAULT_WIP,
    updatedAt: serverTimestamp()
  };
  try {
    await setDoc(doc(db, "boards", id), newBoard);
    const info = normalizeBoard(newBoard, id);
    info.role = "OWNER";
    boards.push(info);
    const picker = $("#boardPicker");
    let ownedGroup = [...picker.querySelectorAll("optgroup")].find(group => group.label === "Meus quadros");
    if (!ownedGroup) {
      ownedGroup = document.createElement("optgroup");
      ownedGroup.label = "Meus quadros";
      picker.prepend(ownedGroup);
    }
    ownedGroup.append(new Option(info.name, id));
    picker.value = id;
    await loadSelectedBoard(info);
    showBoard(currentUser.email);
  } catch (err) {
    console.error("Erro ao criar quadro:", err);
    showStatus("Não foi possível criar o quadro. Verifique as regras do Firestore.", true);
  }
});

/* Autenticação */
$("#switchAuthMode").addEventListener("click", () => setAuthMode(authMode === "signup" ? "login" : "signup"));
togglePassword.addEventListener("click", () => setPasswordVisible(passwordInput.type === "password"));
loginForm.addEventListener("input", () => showMessage(""));
loginForm.addEventListener("submit", async event => {
  event.preventDefault();
  if (!loginForm.reportValidity()) return;
  const email = emailInput.value.trim();
  const password = passwordInput.value;
  const isSignup = authMode === "signup";
  if (isSignup && password !== confirmPasswordInput.value) {
    showMessage("As senhas não conferem.");
    return;
  }
  loginSubmit.disabled = true;
  justSignedUp = isSignup;
  try {
    if (isSignup) await createUserWithEmailAndPassword(auth, email, password);
    else await signInWithEmailAndPassword(auth, email, password);
    loginForm.reset();
    setPasswordVisible(false);
  } catch (err) {
    justSignedUp = false;
    console.error("Erro de autenticação:", err.code);
    showMessage(AUTH_ERRORS[err.code] || "Não foi possível concluir. Tente de novo.");
  } finally {
    loginSubmit.disabled = false;
  }
});

$("#logoutBtn").addEventListener("click", () => {
  if (modal.open) modal.close();
  setPasswordVisible(false);
  signOut(auth).catch(err => {
    console.error("Erro ao sair:", err);
    showStatus("Não foi possível sair. Tente de novo.", true);
  });
});

onAuthStateChanged(auth, async user => {
  currentUser = user;
  boardReady = false;
  currentBoard = null;
  if (!user) {
    if (unsubscribeBoard) unsubscribeBoard();
    unsubscribeBoard = null;
    tasks = [];
    boards = [];
    render();
    setAuthMode("login");
    showLogin();
    return;
  }
  try {
    const acceptedCount = await acceptInvitations(user);
    const { owned, shared } = await loadBoardList(user);
    renderBoardPicker(owned, shared);
    const allBoards = [
      ...owned.map(item => ({ ...item, role: "OWNER" })),
      ...shared
    ];
    const route = routeTaskId();
    let selected = route
      ? allBoards.find(item => item.id === route.slice(0, route.indexOf("~")))
      : null;
    selected ||= allBoards[0];
    await loadSelectedBoard(selected);
    if (route) await renderRoute();
    else showBoard(user.email);
    if (justSignedUp) showStatus("Conta criada com sucesso. Bem-vindo!");
    else if (acceptedCount) showStatus(`Acesso a ${acceptedCount} quadro(s) compartilhado(s) ativado.`);
  } catch (err) {
    console.error("Erro ao carregar quadros:", err);
    tasks = [];
    boardReady = false;
    showBoard(user.email);
    showStatus("Não foi possível carregar os quadros. Verifique as regras do Firestore.", true);
  }
  justSignedUp = false;
});
