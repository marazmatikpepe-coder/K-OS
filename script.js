import { auth, db } from './firebase-config.js';
import { 
    createUserWithEmailAndPassword, 
    signInWithEmailAndPassword, 
    signOut, 
    onAuthStateChanged,
    updateProfile
} from "https://www.gstatic.com/firebasejs/10.8.0/firebase-auth.js";
import { 
    doc, setDoc, getDoc, updateDoc, arrayUnion, arrayRemove 
} from "https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js";

const IMGBB_KEY = "cc09691527f520d75134d23712471d2c";

let currentUser = null;
let currentDesktopItems = [];
let trashItems = [];
let systemConfig = { 
    wallpaper: 'https://i.ibb.co/ccvjPDC4/image-Picsart-Ai-Image-Enhancer.png', 
    language: 'ru', 
    theme: 'dark', 
    password: null 
};
let currentStep = 1;
let setupData = {};

const loadingScreen = document.getElementById('loading-screen');
const authScreen = document.getElementById('auth-screen');
const loginScreen = document.getElementById('login-screen');
const setupScreen = document.getElementById('setup-screen');
const desktop = document.getElementById('desktop');

// ========== ВСПОМОГАТЕЛЬНЫЕ ФУНКЦИИ ==========
function showLoading(show) {
    loadingScreen.style.display = show ? 'flex' : 'none';
}

// ========== ЭТО ЕДИНСТВЕННАЯ ФУНКЦИЯ showScreen (УБРАЛ ДУБЛИРОВАНИЕ) ==========
function showScreen(screen) {
    const screens = [authScreen, loginScreen, setupScreen, desktop];
    screens.forEach(s => {
        if (s) s.style.display = 'none';
    });
    if (screen) {
        screen.style.display = 'flex';
        if (screen === desktop) {
            setTimeout(() => {
                const allChildren = desktop.querySelectorAll('*');
                allChildren.forEach(el => {
                    el.style.filter = 'none';
                    el.style.opacity = '1';
                });
            }, 100);
        }
    }
}

async function saveToFirebase() {
    if (!currentUser) return;
    const userRef = doc(db, 'users', currentUser.uid);
    await setDoc(userRef, {
        desktopItems: currentDesktopItems,
        trashItems: trashItems,
        config: systemConfig
    }, { merge: true });
}

async function loadFromFirebase() {
    if (!currentUser) return;
    const userRef = doc(db, 'users', currentUser.uid);
    const docSnap = await getDoc(userRef);
    if (docSnap.exists()) {
        const data = docSnap.data();
        currentDesktopItems = data.desktopItems || [];
        trashItems = data.trashItems || [];
        systemConfig = { ...systemConfig, ...data.config };
        applyConfig();
        renderDesktop();
    } else {
        currentDesktopItems = [];
        renderDesktop();
    }
}

function applyConfig() {
    if (desktop) {
        desktop.style.backgroundImage = `url(${systemConfig.wallpaper})`;
        desktop.style.backgroundSize = 'cover';
        desktop.style.backgroundPosition = 'center';
        desktop.style.backgroundRepeat = 'no-repeat';
    }
}

function renderDesktop() {
    const container = document.getElementById('desktop-icons');
    if (!container) return;
    container.innerHTML = '';
    currentDesktopItems.forEach(item => {
        const icon = document.createElement('div');
        icon.className = 'desktop-icon';
        icon.setAttribute('data-id', item.id);
        icon.innerHTML = `
            <div class="icon-img">${item.type === 'folder' ? '<i class="fas fa-folder"></i>' : '<i class="fas fa-file"></i>'}</div>
            <div class="icon-label">${item.name}</div>
        `;
        icon.onclick = () => {
            if (item.type === 'folder') openFolder(item);
            else openFile(item);
        };
        icon.oncontextmenu = (e) => {
            e.preventDefault();
            showFileContextMenu(e.pageX, e.pageY, item);
        };
        container.appendChild(icon);
    });
}

// ========== ВСЯ ТВОЯ ЛОГИКА НАСТРОЙКИ ==========
function renderSetupStep() {
    const stepContent = document.getElementById('setup-step-content');
    switch(currentStep) {
        case 1:
            stepContent.innerHTML = `<h2>Добро пожаловать в K-OS!</h2><p>Давайте настроим вашу систему</p>`;
            break;
        case 2:
            stepContent.innerHTML = `<h2>Выберите язык</h2>
                <select id="setup-lang" class="glass-select">
                    <option value="ru">Русский</option><option value="en">English</option>
                    <option value="es">Español</option><option value="zh">中文</option>
                </select>`;
            break;
        case 3:
            stepContent.innerHTML = `<h2>Яркость системы</h2><input type="range" id="setup-brightness" min="0" max="100" value="100">`;
            break;
        case 4:
            stepContent.innerHTML = `<h2>Подключение к Wi-Fi</h2><p>Пропустить (демо)</p>`;
            break;
        case 5:
            stepContent.innerHTML = `<h2>Установить пароль для входа</h2><input type="password" id="setup-password" class="glass-input" placeholder="Пароль">`;
            break;
        case 6:
            stepContent.innerHTML = `<h2>Готово!</h2><p>Наслаждайтесь K-OS</p>`;
            break;
    }
}

function nextSetupStep() {
    if (currentStep === 5) {
        const pwd = document.getElementById('setup-password')?.value;
        if (pwd) systemConfig.password = pwd;
    }
    if (currentStep < 6) {
        currentStep++;
        renderSetupStep();
        document.querySelectorAll('.step-dot').forEach((dot, i) => {
            if (i < currentStep) dot.classList.add('active');
        });
    } else {
        saveToFirebase();
        showScreen(desktop);
        loadFromFirebase();
    }
}

document.getElementById('setup-next')?.addEventListener('click', nextSetupStep);
document.getElementById('setup-prev')?.addEventListener('click', () => {
    if (currentStep > 1) { currentStep--; renderSetupStep(); }
});

function openFolder(folder) {
    Swal.fire({ title: folder.name, text: 'Папка открыта (демо)', background: '#1a1a2e', color: '#fff' });
}

function openFile(file) {
    if (file.url || file.content) {
        const win = document.getElementById('viewer-window');
        win.style.display = 'flex';
        win.style.left = '20%';
        win.style.top = '15%';
        document.getElementById('viewer-image').src = file.url || file.content;
        return;
    }
    if (file.name.endsWith('.txt') || file.name.endsWith('.doc')) {
        const win = document.getElementById('notepad-window');
        win.style.display = 'flex';
        win.style.left = '25%';
        win.style.top = '20%';
        document.getElementById('notepad-content').value = file.content || '';
        window.currentFile = file;
        return;
    }
    alert('Не могу открыть этот файл');
}

function showFileContextMenu(x, y, item) {
    const menu = document.getElementById('file-context-menu');
    menu.style.left = x + 'px';
    menu.style.top = y + 'px';
    menu.style.display = 'flex';
    window.selectedFile = item;
    document.querySelectorAll('#file-context-menu .context-item').forEach(btn => {
        btn.onclick = () => {
            const action = btn.dataset.action;
            if (action === 'rename') {
                const newName = prompt('Новое имя:', item.name);
                if (newName) { item.name = newName; renderDesktop(); saveToFirebase(); }
            } else if (action === 'delete') {
                trashItems.push(item);
                currentDesktopItems = currentDesktopItems.filter(i => i.id !== item.id);
                renderDesktop(); saveToFirebase();
            } else if (action === 'open') openFile(item);
            menu.style.display = 'none';
        };
    });
}

// ========== ВСЯ ТВОЯ ЛОГИКА АВТОРИЗАЦИИ ==========
document.getElementById('do-login')?.addEventListener('click', async () => {
    const email = document.getElementById('auth-email').value;
    const password = document.getElementById('auth-password').value;
    try {
        await signInWithEmailAndPassword(auth, email, password);
    } catch(e) { Swal.fire('Ошибка', e.message, 'error'); }
});

document.getElementById('do-register')?.addEventListener('click', async () => {
    const name = document.getElementById('reg-name').value;
    const email = document.getElementById('reg-email').value;
    const password = document.getElementById('reg-password').value;
    const confirm = document.getElementById('reg-confirm').value;
    if (password !== confirm) return Swal.fire('Ошибка', 'Пароли не совпадают', 'error');
    try {
        const cred = await createUserWithEmailAndPassword(auth, email, password);
        await updateProfile(cred.user, { displayName: name });
        Swal.fire('Успешно!', 'Аккаунт создан', 'success');
    } catch(e) { Swal.fire('Ошибка', e.message, 'error'); }
});

document.querySelectorAll('.tab-btn').forEach(btn => {
    btn.onclick = () => {
        document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        document.querySelectorAll('.auth-form').forEach(f => f.classList.remove('active'));
        document.getElementById(`${btn.dataset.tab}-form`).classList.add('active');
    };
});

document.getElementById('submit-login')?.addEventListener('click', () => {
    const pwd = document.getElementById('login-password').value;
    if (pwd === systemConfig.password) showScreen(desktop);
    else Swal.fire('Ошибка', 'Неверный пароль', 'error');
});

document.getElementById('logout-full')?.addEventListener('click', () => signOut(auth));

// ========== DRAG & DROP ==========
document.body.addEventListener('dragover', (e) => e.preventDefault());
document.body.addEventListener('drop', async (e) => {
    e.preventDefault();
    const files = e.dataTransfer.files;
    for (let file of files) {
        const reader = new FileReader();
        reader.onload = async (event) => {
            let content = event.target.result;
            if (file.type.startsWith('image/')) {
                const formData = new FormData();
                formData.append('image', content.split(',')[1]);
                formData.append('key', IMGBB_KEY);
                const res = await fetch('https://api.imgbb.com/1/upload', { method: 'POST', body: formData });
                const json = await res.json();
                if (json.success) content = json.data.url;
            }
            currentDesktopItems.push({ id: Date.now(), name: file.name, type: 'file', content: content });
            renderDesktop();
            saveToFirebase();
        };
        reader.readAsDataURL(file);
    }
});

// ========== МЕНЮ ПУСК ==========
document.getElementById('start-button')?.addEventListener('click', () => {
    const menu = document.getElementById('start-menu');
    menu.style.display = menu.style.display === 'none' ? 'block' : 'none';
});

// ========== ПЕРСОНАЛИЗАЦИЯ ==========
document.querySelector('[data-action="personalize"]')?.addEventListener('click', () => {
    document.getElementById('personalize-modal').style.display = 'flex';
});
document.querySelector('.modal-close')?.addEventListener('click', () => {
    document.getElementById('personalize-modal').style.display = 'none';
});
document.querySelectorAll('.wallpaper-item').forEach(item => {
    item.onclick = () => {
        systemConfig.wallpaper = item.style.backgroundImage.slice(5, -2);
        applyConfig();
        saveToFirebase();
    };
});
document.getElementById('save-personalize')?.addEventListener('click', () => {
    const lang = document.getElementById('system-language').value;
    systemConfig.language = lang;
    saveToFirebase();
    document.getElementById('personalize-modal').style.display = 'none';
    Swal.fire('Сохранено!', 'Настройки применены', 'success');
});
document.querySelectorAll('.theme-option').forEach(opt => {
    opt.onclick = () => {
        document.querySelectorAll('.theme-option').forEach(o => o.classList.remove('active'));
        opt.classList.add('active');
        systemConfig.theme = opt.dataset.theme;
        applyConfig();
        saveToFirebase();
    };
});

// ========== ЗАКРЫТИЕ ОКОН ==========
document.querySelectorAll('.close-window').forEach(btn => {
    btn.onclick = () => {
        document.getElementById('notepad-window').style.display = 'none';
        document.getElementById('viewer-window').style.display = 'none';
    };
});
document.getElementById('save-notepad')?.addEventListener('click', () => {
    const win = document.getElementById('notepad-window');
    if (window.currentFile) {
        window.currentFile.content = document.getElementById('notepad-content').value;
        saveToFirebase();
    }
    win.style.display = 'none';
});

// ========== КЛИК ВНЕ МЕНЮ ==========
document.addEventListener('click', (e) => {
    if (!e.target.closest('.context-menu')) {
        document.getElementById('context-menu').style.display = 'none';
        document.getElementById('file-context-menu').style.display = 'none';
    }
    if (!e.target.closest('#start-button') && !e.target.closest('#start-menu')) {
        document.getElementById('start-menu').style.display = 'none';
    }
});

// ========== КОНТЕКСТНОЕ МЕНЮ РАБОЧЕГО СТОЛА ==========
desktop?.addEventListener('contextmenu', (e) => {
    if (e.target === desktop || e.target.id === 'desktop-icons') {
        e.preventDefault();
        const menu = document.getElementById('context-menu');
        menu.style.left = e.pageX + 'px';
        menu.style.top = e.pageY + 'px';
        menu.style.display = 'flex';
    }
});
document.querySelectorAll('#context-menu .context-item').forEach(btn => {
    btn.onclick = () => {
        const action = btn.dataset.action;
        if (action === 'personalize') document.getElementById('personalize-modal').style.display = 'flex';
        if (action === 'create-folder') {
            currentDesktopItems.push({ id: Date.now(), name: 'Новая папка', type: 'folder', children: [] });
            renderDesktop(); saveToFirebase();
        }
        if (action === 'create-file-txt') {
            currentDesktopItems.push({ id: Date.now(), name: 'новый.txt', type: 'file', content: '' });
            renderDesktop(); saveToFirebase();
        }
        if (action === 'create-file-doc') {
            currentDesktopItems.push({ id: Date.now(), name: 'новый.doc', type: 'file', content: '' });
            renderDesktop(); saveToFirebase();
        }
        if (action === 'upload-wallpaper') {
            const input = document.createElement('input');
            input.type = 'file';
            input.accept = 'image/*';
            input.onchange = async (e) => {
                const file = e.target.files[0];
                if (!file) return;
                const reader = new FileReader();
                reader.onload = async (ev) => {
                    try {
                        const formData = new FormData();
                        formData.append('image', ev.target.result.split(',')[1]);
                        formData.append('key', IMGBB_KEY);
                        const res = await fetch('https://api.imgbb.com/1/upload', { method: 'POST', body: formData });
                        const json = await res.json();
                        if (json.success) {
                            systemConfig.wallpaper = json.data.url;
                            applyConfig();
                            saveToFirebase();
                            Swal.fire('Успешно!', 'Обои обновлены', 'success');
                        }
                    } catch (err) { console.error(err); }
                };
                reader.readAsDataURL(file);
            };
            input.click();
        }
        document.getElementById('context-menu').style.display = 'none';
    };
});

// ========== AUTH STATE (ТВОЯ ЛОГИКА) ==========
onAuthStateChanged(auth, async (user) => {
    console.log("Auth state changed:", user ? "Пользователь есть" : "Нет пользователя");
    
    try {
        if (user) {
            console.log("Загрузка данных пользователя...");
            currentUser = user;
            await loadFromFirebase();
            console.log("Данные загружены, config:", systemConfig);
            
            if (systemConfig.password) {
                console.log("Показываем экран входа с паролем");
                showScreen(loginScreen);
            } else {
                console.log("Показываем рабочий стол");
                showScreen(desktop);
            }
        } else {
            console.log("Нет пользователя, показываем экран авторизации");
            currentStep = 1;
            showScreen(authScreen);
            renderSetupStep();
        }
    } catch (error) {
        console.error("Ошибка при загрузке:", error);
        Swal.fire({
            title: "Ошибка",
            text: "Не удалось загрузить систему: " + error.message,
            icon: "error",
            background: "#1a1a2e",
            color: "#fff"
        });
    } finally {
        console.log("Скрываем загрузку");
        showLoading(false);
    }
});

console.log('✅ K-OS загружена!');
