let audioContext;
let masterGain, analyser, delayNode, feedbackGain, delayMixOut, filterNode, globalLfoNode, lfoGainNode;
let activeNotes = {};

const ui = {
    canvas: document.getElementById('oscilloscope'),
    triggerBtn: document.getElementById('trigger-btn')
};

const params = {
    osc1Wave: 'sawtooth', osc1Oct: 0, osc1Vol: 0.7,
    osc2Wave: 'square', osc2Oct: -1, osc2Detune: 10, osc2Vol: 0.5,
    atk: 0.05, dec: 0.2, sus: 0.5, rel: 0.5,
    filterType: 'lowpass', cutoff: 2000, q: 2, filterEnv: 25,
    lfoTarget: 'filter', lfoRate: 6, lfoDepth: 10,
    delayTime: 0.3, delayFeed: 0.3, delayMix: 0.15,
    freq: 440, vol: 0.5
};

function setupUIControls() {
    let activeControl = null;
    let startY = 0;
    let startVal = 0;

    const knobs = document.querySelectorAll('.knob');
    const fader = document.querySelector('.vertical-fader');
    const uiElements = [...knobs];
    if (fader) uiElements.push(fader);

    uiElements.forEach(el => {
        updateVisual(el);

        const onStart = (clientY) => {
            activeControl = el;
            startY = clientY;
            startVal = parseFloat(el.getAttribute('data-value'));
            document.body.style.cursor = 'ns-resize';
        };

        el.addEventListener('mousedown', (e) => {
            e.preventDefault();
            onStart(e.clientY);
        });

        el.addEventListener('touchstart', (e) => {
            e.preventDefault();
            onStart(e.touches[0].clientY);
        }, { passive: false });
    });

    const onMove = (clientY) => {
        if (!activeControl) return;
        const deltaY = startY - clientY;
        handleDrag(activeControl, deltaY);
    };

    window.addEventListener('mousemove', (e) => { onMove(e.clientY); });
    window.addEventListener('touchmove', (e) => {
        if (activeControl) {
            e.preventDefault();
            onMove(e.touches[0].clientY);
        }
    }, { passive: false });

    const onEnd = () => {
        if (activeControl) {
            activeControl = null;
            document.body.style.cursor = 'default';
        }
    };

    window.addEventListener('mouseup', onEnd);
    window.addEventListener('touchend', onEnd);

    function handleDrag(el, delta) {
        const min = parseFloat(el.getAttribute('data-min'));
        const max = parseFloat(el.getAttribute('data-max'));
        const range = max - min;
        const step = parseFloat(el.getAttribute('data-step'));
        const paramStr = el.getAttribute('data-param');

        let sensitivity = el.classList.contains('vertical-fader') ? 0.01 : 0.005;
        let newVal = startVal + (delta * range * sensitivity);
        newVal = Math.max(min, Math.min(max, newVal));

        const invStep = 1 / step;
        newVal = Math.round(newVal * invStep) / invStep;

        el.setAttribute('data-value', newVal);
        updateVisual(el);

        params[paramStr] = newVal;
        updateGlobalParams();
    }

    function updateVisual(el) {
        const min = parseFloat(el.getAttribute('data-min'));
        const max = parseFloat(el.getAttribute('data-max'));
        const val = parseFloat(el.getAttribute('data-value'));
        const isFader = el.classList.contains('vertical-fader');

        const textElement = el.parentElement.querySelector('.knob-val');
        if (textElement) textElement.textContent = val;

        const percent = (val - min) / (max - min);

        if (isFader) {
            const thumb = el.querySelector('.fader-thumb');
            if (thumb) thumb.style.top = `${100 - (percent * 100)}%`;
        } else {
            const dial = el.querySelector('.knob-dial');
            const angle = -135 + (percent * 270);
            if (dial) dial.style.transform = `rotate(${angle}deg)`;
        }
    }

    document.querySelectorAll('.synth-select').forEach(sel => {
        sel.addEventListener('change', (e) => {
            const paramKey = sel.getAttribute('data-param');
            params[paramKey] = e.target.value;
            updateGlobalParams();
        });
    });
}

function initAudioContext() {
    if (!audioContext) {
        audioContext = new (window.AudioContext || window.webkitAudioContext)();
        masterGain = audioContext.createGain();
        masterGain.gain.value = params.vol;

        filterNode = audioContext.createBiquadFilter();

        delayNode = audioContext.createDelay(2.0);
        feedbackGain = audioContext.createGain();
        delayMixOut = audioContext.createGain();

        globalLfoNode = audioContext.createOscillator();
        lfoGainNode = audioContext.createGain();
        globalLfoNode.type = 'sine';
        globalLfoNode.start();
        globalLfoNode.connect(lfoGainNode);

        analyser = audioContext.createAnalyser();
        analyser.fftSize = 2048;

        filterNode.connect(masterGain);

        filterNode.connect(delayNode);
        delayNode.connect(feedbackGain);
        feedbackGain.connect(delayNode);
        delayNode.connect(delayMixOut);
        delayMixOut.connect(masterGain);

        masterGain.connect(analyser);
        analyser.connect(audioContext.destination);

        updateGlobalParams();
        drawOscilloscope();
    }
    if (audioContext.state === 'suspended') {
        audioContext.resume();
    }
}

function updateGlobalParams() {
    if (!audioContext) return;
    const now = audioContext.currentTime;

    masterGain.gain.setTargetAtTime(params.vol, now, 0.05);
    filterNode.type = params.filterType;
    filterNode.Q.setTargetAtTime(params.q, now, 0.05);

    delayNode.delayTime.setTargetAtTime(params.delayTime, now, 0.05);
    feedbackGain.gain.setTargetAtTime(params.delayFeed, now, 0.05);
    delayMixOut.gain.setTargetAtTime(params.delayMix, now, 0.05);
    globalLfoNode.frequency.setTargetAtTime(params.lfoRate, now, 0.05);

    lfoGainNode.disconnect();

    if (params.lfoTarget === 'filter') {
        lfoGainNode.gain.value = params.lfoDepth * 50;
        lfoGainNode.connect(filterNode.frequency);
        filterNode.frequency.setTargetAtTime(params.cutoff, now, 0.05);
    } else if (params.lfoTarget === 'pitch') {
        lfoGainNode.gain.value = params.lfoDepth * 2;
        filterNode.frequency.setTargetAtTime(params.cutoff, now, 0.05);
    } else {
        filterNode.frequency.setTargetAtTime(params.cutoff, now, 0.05);
    }

    Object.values(activeNotes).forEach(voice => {
        voice.osc1.type = params.osc1Wave;
        voice.osc1VolNode.gain.setTargetAtTime(params.osc1Vol, now, 0.05);

        const f = voice.isKeyboard ? voice.baseFreq : params.freq;
        voice.osc1.frequency.setTargetAtTime(f * Math.pow(2, params.osc1Oct), now, 0.05);
        voice.osc2.frequency.setTargetAtTime(f * Math.pow(2, params.osc2Oct), now, 0.05);

        voice.osc2.type = params.osc2Wave;
        voice.osc2.detune.setTargetAtTime(params.osc2Detune, now, 0.05);
        voice.osc2VolNode.gain.setTargetAtTime(params.osc2Vol, now, 0.05);

        if (params.lfoTarget === 'pitch') {
            lfoGainNode.connect(voice.osc1.detune);
            lfoGainNode.connect(voice.osc2.detune);
        }
    });
}

function noteOn(frequency = params.freq, isKeyboard = false) {
    initAudioContext();
    if (activeNotes[frequency]) return;

    const now = audioContext.currentTime;

    const osc1 = audioContext.createOscillator();
    const osc1VolNode = audioContext.createGain();
    osc1.type = params.osc1Wave;
    osc1.frequency.value = frequency * Math.pow(2, params.osc1Oct);
    osc1VolNode.gain.value = params.osc1Vol;
    osc1.connect(osc1VolNode);

    const osc2 = audioContext.createOscillator();
    const osc2VolNode = audioContext.createGain();
    osc2.type = params.osc2Wave;
    osc2.frequency.value = frequency * Math.pow(2, params.osc2Oct);
    osc2.detune.value = params.osc2Detune;
    osc2VolNode.gain.value = params.osc2Vol;
    osc2.connect(osc2VolNode);

    if (params.lfoTarget === 'pitch') {
        lfoGainNode.connect(osc1.detune);
        lfoGainNode.connect(osc2.detune);
    }

    const voiceMix = audioContext.createGain();
    osc1VolNode.connect(voiceMix);
    osc2VolNode.connect(voiceMix);

    const ampEnv = audioContext.createGain();
    ampEnv.gain.setValueAtTime(0, now);
    ampEnv.gain.linearRampToValueAtTime(1.0, now + params.atk);
    ampEnv.gain.setTargetAtTime(params.sus, now + params.atk, params.dec);

    voiceMix.connect(ampEnv);
    ampEnv.connect(filterNode);

    const filterEnvAmt = (params.filterEnv / 100) * 4000;
    if (params.filterEnv > 0) {
        filterNode.frequency.cancelScheduledValues(now);
        filterNode.frequency.setValueAtTime(params.cutoff, now);
        filterNode.frequency.linearRampToValueAtTime(params.cutoff + filterEnvAmt, now + params.atk);
        const susCutoff = params.cutoff + (filterEnvAmt * params.sus);
        filterNode.frequency.setTargetAtTime(susCutoff, now + params.atk, params.dec);
    }

    osc1.start(now);
    osc2.start(now);

    activeNotes[frequency] = { osc1, osc2, osc1VolNode, osc2VolNode, ampEnv, baseFreq: frequency, isKeyboard };
    ui.triggerBtn.classList.add('active');
}

function noteOff(frequency = params.freq) {
    if (!activeNotes[frequency]) return;

    const voice = activeNotes[frequency];
    const now = audioContext.currentTime;

    const currentGain = voice.ampEnv.gain.value;
    voice.ampEnv.gain.cancelScheduledValues(now);
    voice.ampEnv.gain.setValueAtTime(currentGain, now);
    voice.ampEnv.gain.setTargetAtTime(0.0001, now, params.rel / 3);

    if (params.filterEnv > 0) {
        filterNode.frequency.cancelScheduledValues(now);
        filterNode.frequency.setTargetAtTime(params.cutoff, now, params.rel / 3);
    }

    voice.osc1.stop(now + params.rel);
    voice.osc2.stop(now + params.rel);

    voice.osc1.onended = () => {
        voice.osc1.disconnect();
        voice.osc2.disconnect();
        voice.ampEnv.disconnect();
    };

    delete activeNotes[frequency];
    if (Object.keys(activeNotes).length === 0) {
        ui.triggerBtn.classList.remove('active');
    }
}

function drawOscilloscope() {
    if (!ui.canvas) return;
    const ctx = ui.canvas.getContext('2d');
    const width = ui.canvas.width;
    const height = ui.canvas.height;
    const bufferLength = analyser.frequencyBinCount;
    const dataArray = new Uint8Array(bufferLength);

    function draw() {
        requestAnimationFrame(draw);
        analyser.getByteTimeDomainData(dataArray);

        ctx.fillStyle = 'rgba(10, 15, 20, 0.4)';
        ctx.fillRect(0, 0, width, height);

        ctx.lineWidth = 3;
        ctx.lineJoin = 'round';
        ctx.strokeStyle = '#00e6a8';
        ctx.shadowBlur = 10;
        ctx.shadowColor = '#00e6a8';

        ctx.beginPath();
        const sliceWidth = width * 1.0 / bufferLength;
        let x = 0;

        for (let i = 0; i < bufferLength; i++) {
            const v = dataArray[i] / 128.0;
            const y = v * height / 2;
            if (i === 0) ctx.moveTo(x, y);
            else ctx.lineTo(x, y);
            x += sliceWidth;
        }
        ctx.lineTo(width, height / 2);
        ctx.stroke();
        ctx.shadowBlur = 0;
    }
    draw();
}

ui.triggerBtn.addEventListener('mousedown', () => noteOn());
ui.triggerBtn.addEventListener('mouseup', () => noteOff());
ui.triggerBtn.addEventListener('mouseleave', () => noteOff());
ui.triggerBtn.addEventListener('touchstart', (e) => { e.preventDefault(); noteOn(); });
ui.triggerBtn.addEventListener('touchend', (e) => { e.preventDefault(); noteOff(); });

const keyMap = {
    'a': 261.63, 'w': 277.18, 's': 293.66, 'e': 311.13, 'd': 329.63, 'f': 349.23,
    't': 369.99, 'g': 392.00, 'y': 415.30, 'h': 440.00, 'u': 466.16, 'j': 493.88, 'k': 523.25
};

window.addEventListener('keydown', (e) => {
    if (e.repeat) return;
    const key = e.key.toLowerCase();
    if (keyMap[key]) noteOn(keyMap[key], true);
});
window.addEventListener('keyup', (e) => {
    const key = e.key.toLowerCase();
    if (keyMap[key]) noteOff(keyMap[key]);
});

setupUIControls();
