import { auth, db, storage } from './firebase-config.js';
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
import { ref, uploadString, getDownloadURL } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-storage.js";

// Конфиг ImgBB
const IMGBB_KEY = "cc09691527f520d75134d23712471d2c";

// Глобальные переменные
let currentUser = null;
let currentDesktopItems = []; // { id, name, type, content, path? }
let trashItems = [];
let systemConfig = { wallpaper: 'https://i.ibb.co/tgktvGq/image.png', language: 'ru', theme: 'dark', password: null };
let currentStep = 1;
let setupData = { email: '', password: '', name: '', language: 'ru', brightness: 100, wifi: null, biometric: false };

// DOM элементы
const loadingScreen = document.getElementById('loading-screen');
const loginScreen = document.getElementById('login-screen');
const setupScreen = document.getElementById('setup-screen');
const desktop = document.getElementById('desktop');
const desktopIcons = document.getElementById('desktop-icons');
const contextMenu = document.getElementById('context-menu');
const fileContextMenu = document.getElementById('file-context-menu');
const personalizeModal = document.getElementById('personalize-modal');
const startMenu = document.getElementById('start-menu');
const startButton = document.getElementById('start-button');
const notepadWindow = document.getElementById('notepad-window');
const viewerWindow = document.getElementById('viewer-window');
const trash = document.getElementById('trash');

// =================== ВСПОМОГАТЕЛЬНЫЕ ФУНКЦИИ ===================
function showLoading(show) {
    loadingScreen.style.display = show ? 'flex' : 'none';
}

function showScreen(screen) {
    loginScreen.style.display = 'none';
    setupScreen.style.display = 'none';
    desktop.style.display = 'none';
    screen.style.display = 'block';
}

function saveToFirebase() {
    if (!currentUser) return;
    const userRef = doc(db, 'users', currentUser.uid);
    setDoc(userRef, {
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
        // Первый вход — стандартные иконки
        currentDesktopItems = [
            { id: 'folder1', name: 'Мои документы', type: 'folder', children: [] },
        ];
        renderDesktop();
    }
}

function applyConfig() {
    desktop.style.backgroundImage = `url(${systemConfig.wallpaper})`;
    document.body.style.background = systemConfig.theme === 'dark' ? '#0a0a0a' : '#f0f0f0';
    document.body.style.color = systemConfig.theme === 'dark' ? 'white' : 'black';
}

function renderDesktop() {
    desktopIcons.innerHTML = '';
    currentDesktopItems.forEach(item => {
        const icon = document.createElement('div');
        icon.className = 'desktop-icon';
        icon.draggable = true;
        icon.setAttribute('data-id', item.id);
        icon.innerHTML = `
            <div class="icon-img">${item.type === 'folder' ? '📁' : '📄'}</div>
            <div class="icon-label">${item.name}</div>
        `;
        icon.addEventListener('click', (e) => {
            e.stopPropagation();
            if (item.type === 'folder') openFolder(item);
            else openFile(item);
        });
        icon.addEventListener('contextmenu', (e) => {
            e.preventDefault();
            showFileContextMenu(e.pageX, e.pageY, item);
        });
        desktopIcons.appendChild(icon);
    });
}

function openFolder(folder) {
    alert(`Открыта папка: ${folder.name}\n(Файлов: ${folder.children?.length || 0})`);
    // Можно реализовать окно папки
}

function openFile(file) {
    if (file.name.endsWith('.txt') || file.name.endsWith('.doc')) {
        notepadWindow.style.display = 'block';
        document.getElementById('notepad-content').value = file.content || '';
        window.currentEditingFile = file;
    } else if (file.name.match(/\.(jpg|jpeg|png|gif|webp)$/i)) {
        viewerWindow.style.display = 'block';
        document.getElementById('viewer-image').src = file.content || file.path || '';
        window.currentViewingFile = file;
    }
}

function showFileContextMenu(x, y, item) {
    fileContextMenu.style.left = x + 'px';
    fileContextMenu.style.top = y + 'px';
    fileContextMenu.style.display = 'flex';
    window.selectedFile = item;
    
    // Обработчики
    document.querySelectorAll('#file-context-menu .context-item').forEach(btn => {
        btn.onclick = () => {
            const action = btn.dataset.action;
            if (action === 'rename') {
                const newName = prompt('Новое имя:', item.name);
                if (newName) { item.name = newName; renderDesktop(); saveToFirebase(); }
            } else if (action === 'delete') {
                trashItems.push(item);
                currentDesktopItems = currentDesktopItems.filter(i => i.id !== item.id);
                renderDesktop();
                saveToFirebase();
            } else if (action === 'open') {
                openFile(item);
            }
            fileContextMenu.style.display = 'none';
        };
    });
}

// =================== НАСТРОЙКА WIZARD ===================
function renderSetupStep() {
    const stepContent = document.getElementById('setup-step-content');
    const progress = (currentStep / 6) * 100;
    document.getElementById('setup-progress-bar').style.width = progress + '%';
    
    switch(currentStep) {
        case 1:
            stepContent.innerHTML = `
                <h2>1/6 Войдите в аккаунт</h2>
                <input type="email" id="setup-email" placeholder="Email" class="glass-input" style="width:100%; margin:10px 0">
                <input type="password" id="setup-pwd" placeholder="Пароль" class="glass-input" style="width:100%; margin:10px 0">
                <button id="setup-login-btn" class="glass-button">Войти</button>
                <hr>
                <h3>Нет аккаунта? Зарегистрируйтесь</h3>
                <input type="text" id="reg-name" placeholder="Имя" class="glass-input" style="width:100%; margin:10px 0">
                <input type="email" id="reg-email" placeholder="Email" class="glass-input" style="width:100%; margin:10px 0">
                <input type="password" id="reg-pwd" placeholder="Пароль" class="glass-input" style="width:100%; margin:10px 0">
                <button id="setup-register-btn" class="glass-button">Зарегистрироваться</button>
            `;
            document.getElementById('setup-login-btn')?.addEventListener('click', async () => {
                const email = document.getElementById('setup-email').value;
                const pwd = document.getElementById('setup-pwd').value;
                try {
                    await signInWithEmailAndPassword(auth, email, pwd);
                    goToNextStep();
                } catch(e) { alert('Ошибка: ' + e.message); }
            });
            document.getElementById('setup-register-btn')?.addEventListener('click', async () => {
                const name = document.getElementById('reg-name').value;
                const email = document.getElementById('reg-email').value;
                const pwd = document.getElementById('reg-pwd').value;
                try {
                    const cred = await createUserWithEmailAndPassword(auth, email, pwd);
                    await updateProfile(cred.user, { displayName: name });
                    setupData.name = name;
                    goToNextStep();
                } catch(e) { alert('Ошибка: ' + e.message); }
            });
            break;
        case 2:
            stepContent.innerHTML = `<h2>2/6 Выберите язык системы</h2>
                <select id="setup-lang" class="glass-input">
                    <option value="en">English</option><option value="ru">Русский</option>
                    <option value="es">Español</option><option value="zh">中文</option>
                    <option value="de">Deutsch</option><option value="fr">Français</option>
                    <option value="pt">Português</option><option value="ar">العربية</option>
                    <option value="ja">日本語</option><option value="ko">한국어</option>
                </select>`;
            break;
        case 3:
            stepContent.innerHTML = `<h2>3/6 Яркость системы</h2>
                <input type="range" id="setup-brightness" min="0" max="100" value="100">`;
            break;
        case 4:
            stepContent.innerHTML = `<h2>4/6 Подключение к Wi-Fi</h2><p>(Демо) Нажмите Далее для пропуска</p>`;
            break;
        case 5:
            stepContent.innerHTML = `<h2>5/6 Биометрия и безопасность</h2>
                <label><input type="checkbox" id="setup-biometric"> Включить биометрию (демо)</label><br>
                <label>Установить пароль для входа в K-OS: <input type="password" id="setup-password" class="glass-input"></label>`;
            break;
        case 6:
            stepContent.innerHTML = `<h2>6/6 Добро пожаловать в K-OS!</h2><p>Настройка завершена. Наслаждайтесь!</p>`;
            break;
    }
}

function goToNextStep() {
    if (currentStep === 1 && !auth.currentUser) {
        alert('Сначала войдите или зарегистрируйтесь');
        return;
    }
    if (currentStep === 2) setupData.language = document.getElementById('setup-lang')?.value || 'en';
    if (currentStep === 3) setupData.brightness = document.getElementById('setup-brightness')?.value || 100;
    if (currentStep === 5) {
        setupData.biometric = document.getElementById('setup-biometric')?.checked || false;
        const pwd = document.getElementById('setup-password')?.value;
        if (pwd) systemConfig.password = pwd;
    }
    if (currentStep < 6) {
        currentStep++;
        renderSetupStep();
    } else {
        // Завершить настройку
        systemConfig.language = setupData.language;
        saveToFirebase();
        showScreen(desktop);
        loadFromFirebase();
    }
}

// =================== DRAG & DROP ФАЙЛОВ ===================
document.body.addEventListener('dragover', (e) => e.preventDefault());
document.body.addEventListener('drop', async (e) => {
    e.preventDefault();
    const files = e.dataTransfer.files;
    for (let file of files) {
        const reader = new FileReader();
        reader.onload = async (event) => {
            let content = event.target.result;
            let fileType = 'file';
            let filePath = null;
            
            if (file.type.startsWith('image/')) {
                // Загружаем на ImgBB
                const formData = new FormData();
                formData.append('image', content.split(',')[1]);
                formData.append('key', IMGBB_KEY);
                const res = await fetch('https://api.imgbb.com/1/upload', { method: 'POST', body: formData });
                const json = await res.json();
                if (json.success) filePath = json.data.url;
                content = filePath;
            }
            
            const newItem = {
                id: Date.now() + Math.random(),
                name: file.name,
                type: fileType,
                content: content,
                path: filePath
            };
            currentDesktopItems.push(newItem);
            renderDesktop();
            saveToFirebase();
        };
        reader.readAsDataURL(file);
    }
});

// =================== ЗАПУСК ===================
onAuthStateChanged(auth, async (user) => {
    showLoading(true);
    setTimeout(async () => {
        if (user) {
            currentUser = user;
            await loadFromFirebase();
            if (systemConfig.password) {
                showScreen(loginScreen);
                document.getElementById('submit-login').onclick = () => {
                    const pwd = document.getElementById('login-password').value;
                    if (pwd === systemConfig.password) {
                        showScreen(desktop);
                    } else alert('Неверный пароль');
                };
                document.getElementById('logout-full').onclick = () => signOut(auth);
            } else {
                showScreen(desktop);
            }
        } else {
            currentStep = 1;
            showScreen(setupScreen);
            renderSetupStep();
        }
        showLoading(false);
    }, 1500);
});

// Контекстное меню на рабочем столе
desktop.addEventListener('contextmenu', (e) => {
    if (e.target === desktop || e.target === desktopIcons) {
        e.preventDefault();
        contextMenu.style.left = e.pageX + 'px';
        contextMenu.style.top = e.pageY + 'px';
        contextMenu.style.display = 'flex';
    } else {
        contextMenu.style.display = 'none';
    }
});
document.querySelectorAll('#context-menu .context
