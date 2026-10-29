/* ============================================================
   Simulador de Planta CTC Energy  ·  app.js
   Modelo -> render. Sin dependencias.
   ============================================================ */
'use strict';

/* ---------------- constantes ---------------- */
const ESCALA = 20;                 // px por metro
const LS_KEY = 'ctc_simulador_v1';
const MAX_HIST = 40;
const NOM_TIPO = { puerta: 'Puerta', ventana: 'Ventana', hueco: 'Abertura sin puerta' };
const COLORES = { objeto: '#f1c40f', edificacion: '#3498db', libre: '#7dcea0' };

/* ---------------- estado ---------------- */
let estado = { ancho: 10.13, fondo: 20.45, bloques: [], aberturas: [] };
let SNAP = 20;
let zoomActual = 1;
let zTop = 1;
let idSeq = 0;

const fotos = {};                  // id -> dataURL (no se duplica en el historial)
let fotoSeq = 0;
const fotosPared = {};

let historial = [];
let histIdx = -1;

let cam = { rx: -55, ry: -25, z: 1 };
let mundoW = 0, mundoF = 0;

/* ---------------- utilidades ---------------- */
const $ = id => document.getElementById(id);
const num = (v, def = 0) => { const n = parseFloat(v); return isFinite(n) ? n : def; };
const m2 = n => n.toFixed(2) + ' m²';

function aviso(msg, tipo) {
  const c = $('avisos'); if (!c) return;
  const d = document.createElement('div');
  d.className = 'aviso' + (tipo ? ' ' + tipo : '');
  d.textContent = msg;
  c.appendChild(d);
  setTimeout(() => d.remove(), 2600);
}
const error = msg => aviso(msg, 'error');
const ok = msg => aviso(msg, 'ok');

function nuevoId(pref) { return pref + (++idSeq); }

/* ============================================================
   HISTORIAL
   ============================================================ */
function guardarHistorial() {
  const s = JSON.stringify(estado);
  if (histIdx >= 0 && JSON.stringify(historial[histIdx]) === s) { guardarLocal(); return; }
  historial = historial.slice(0, histIdx + 1);
  historial.push(JSON.parse(s));
  histIdx = historial.length - 1;
  if (historial.length > MAX_HIST) { historial.shift(); histIdx--; }
  guardarLocal();
}

function deshacer() {
  if (histIdx <= 0) { aviso('No hay cambios que deshacer'); return; }
  histIdx--;
  estado = JSON.parse(JSON.stringify(historial[histIdx]));
  aplicarEstado();
}

/* ============================================================
   BODEGA
   ============================================================ */
function crearBodega(ancho, fondo, forzar) {
  ancho = num(ancho, num($('anchoBodega').value));
  fondo = num(fondo, num($('fondoBodega').value));
  if (!ancho || !fondo || ancho < 1 || fondo < 1) { error('Medidas inválidas'); return false; }
  if (!forzar && estado.bloques.length && !confirm('Esto borra el plano actual. ¿Continuar?')) return false;

  estado = { ancho, fondo, bloques: [], aberturas: [] };
  $('anchoBodega').value = ancho;
  $('fondoBodega').value = fondo;

  const b = $('bodega');
  b.querySelectorAll('.bloque-wrapper, .ab-ov').forEach(e => e.remove());
  montarReglas();
  b.style.width = (ancho * ESCALA) + 'px';
  b.style.height = (fondo * ESCALA) + 'px';
  $('regla-x').style.width = (ancho * ESCALA) + 'px';
  $('regla-y').style.height = (fondo * ESCALA) + 'px';
  dibujarReglas(ancho, fondo);

  const ws = $('workspace');
  zoomActual = Math.min((ws.clientWidth - 110) / (ancho * ESCALA), (ws.clientHeight - 110) / (fondo * ESCALA), 2.5);
  if (!isFinite(zoomActual) || zoomActual <= 0) zoomActual = 1;
  aplicarZoom();

  historial = []; histIdx = -1;
  guardarHistorial();          // estado vacío inicial (permite deshacer el 1er bloque)
  render();
  prepararImpresion();
  return true;
}

function montarReglas() {
  const bod = $('bodega'), rx = $('regla-x'), ry = $('regla-y');
  if (!bod || !rx || !ry) return;
  if (rx.parentElement !== bod) bod.appendChild(rx);
  if (ry.parentElement !== bod) bod.appendChild(ry);
  rx.style.left = '0px'; rx.style.top = '-27px';
  ry.style.left = '-27px'; ry.style.top = '0px';
}

function dibujarReglas(ancho, fondo) {
  const rx = $('regla-x'), ry = $('regla-y');
  rx.innerHTML = ''; ry.innerHTML = '';
  for (let i = 0; i <= Math.floor(ancho); i++) {
    const m = document.createElement('div'); m.className = 'marca-x';
    m.style.left = (i * ESCALA) + 'px'; m.textContent = i; rx.appendChild(m);
  }
  for (let i = 0; i <= Math.floor(fondo); i++) {
    const m = document.createElement('div'); m.className = 'marca-y';
    m.style.top = (i * ESCALA) + 'px'; m.textContent = i; ry.appendChild(m);
  }
}

function aplicarZoom() {
  zoomActual = Math.max(0.1, Math.min(3, zoomActual));
  $('wrapper').style.transform = 'scale(' + zoomActual + ')';
  $('txtZoom').textContent = Math.round(zoomActual * 100) + '%';
}
function cambiarZoom(d) { zoomActual += d; aplicarZoom(); }

/* ============================================================
   FOTOS
   ============================================================ */
function cargarFoto(file, cb, maxPx) {
  const r = new FileReader();
  r.onerror = () => cb(null);
  r.onload = () => {
    const img = new Image();
    img.onerror = () => cb(null);
    img.onload = () => {
      const k = Math.min(1, (maxPx || 500) / Math.max(img.width, img.height));
      const c = document.createElement('canvas');
      c.width = Math.max(1, Math.round(img.width * k));
      c.height = Math.max(1, Math.round(img.height * k));
      c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
      cb(c.toDataURL('image/jpeg', 0.8));
    };
    img.src = r.result;
  };
  r.readAsDataURL(file);
}

function cargarPared(inp) {
  const clave = inp.dataset.pared;
  const f = inp.files && inp.files[0];
  if (!f) { delete fotosPared[clave]; return; }
  cargarFoto(f, url => {
    if (url) { fotosPared[clave] = url; ok('Foto de pared cargada'); }
    else error('No se pudo leer la foto');
  }, 1600);
}

/* ============================================================
   BLOQUES
   ============================================================ */
function leerFormulario() {
  const cat = $('categoriaBloque').value;
  const b = {
    id: nuevoId('b'),
    cod: '',
    cat,
    nombre: ($('nombreBloque').value || '').trim() || 'Equipo',
    a: num($('anchoBloque').value, 1),
    f: num($('fondoBloque').value, 1),
    h: Math.max(0.1, num($('altoBloque').value, 2)),
    color: $('colorBloque').value || COLORES[cat],
    peso: Math.max(0, num($('pesoBloque').value)),
    marca: null, stand: null, estante: null, foto: null, rot: false,
    x: 0, y: 0
  };
  if (b.a <= 0 || b.f <= 0) return null;
  if (cat === 'objeto' && $('conMarca').checked) b.marca = num($('anchoMarca').value, 20);
  if (cat === 'objeto' && $('esStand').checked) {
    b.stand = {
      niveles: Math.max(1, parseInt($('nivelesStand').value, 10) || 1),
      altoNivel: Math.max(0.1, num($('altoNivel').value, 1.2)),
      carga: Math.max(0, num($('cargaNivel').value)),
      contenido: []
    };
  }
  if (cat === 'objeto' && $('esEstante').checked) {
    b.estante = {
      repisas: Math.max(1, parseInt($('nRepisas').value, 10) || 1),
      h0: Math.max(0, num($('h0Repisa').value, 0.1)),
      sep: Math.max(0.05, num($('sepRepisa').value, 0.36))
    };
  }
  return b;
}

function siguienteCodigo(cat) {
  const pre = { objeto: 'EQ', edificacion: 'E', libre: 'MA' }[cat];
  let max = 0;
  estado.bloques.forEach(b => {
    if (b.cat === cat) max = Math.max(max, parseInt((b.cod || '').slice(pre.length), 10) || 0);
  });
  return pre + (max + 1);
}

function agregarBloque() {
  const b = leerFormulario();
  if (!b) { error('Revisa el ancho y el fondo'); return; }
  const cant = Math.max(1, Math.min(50, parseInt($('cantBloque').value, 10) || 1));
  const destino = $('destino').value;
  const file = $('fotoBloque').files && $('fotoBloque').files[0];

  const crear = (fotoUrl) => {
    let n = 0;
    for (let i = 0; i < cant; i++) {
      const copia = JSON.parse(JSON.stringify(b));
      copia.id = nuevoId('b');
      if (destino && b.cat !== 'libre') {
        if (!meterEnStand(destino, copia)) break;
        n++; continue;
      }
      copia.cod = siguienteCodigo(b.cat);
      if (fotoUrl) {
        const fid = 'f' + (++fotoSeq);
        fotos[fid] = fotoUrl; copia.foto = fid;
      }
      if (ubicar(copia)) n++;
      else break;
    }
    if (fotoUrl) $('fotoBloque').value = '';
    if (n) { render(); guardarHistorial(); $('nombreBloque').value = ''; }
    if (!destino) refrescarDestinos();
  };

  if (!file) { crear(null); return; }
  cargarFoto(file, url => crear(url), 500);
}

// busca hueco y agrega al modelo
function ubicar(b) {
  const wpx = b.a * ESCALA, hpx = b.f * ESCALA;
  if (b.cat !== 'libre' && areaOcupada() + b.a * b.f > estado.ancho * estado.fondo + 1e-9) {
    error('No cabe: se pasa del área total');
    return false;
  }
  const fantasma = { dataset: { categoria: b.cat } };
  const libre = buscarLibre(fantasma, wpx, hpx, 0, 0);
  if (!libre) { error('No hay espacio libre para ' + b.nombre); return false; }
  b.x = libre.x; b.y = libre.y;
  estado.bloques.push(b);
  return true;
}

function borrarBloque(id) {
  estado.bloques = estado.bloques.filter(b => b.id !== id);
  estado.aberturas = estado.aberturas.filter(a => a.dueno !== id);
  render(); guardarHistorial();
}

function rotarBloque(id) {
  const b = estado.bloques.find(x => x.id === id); if (!b) return;
  const a = b.a, f = b.f;
  const wpx = f * ESCALA, hpx = a * ESCALA;
  const dom = document.getElementById('bodega');
  const fantasma = { dataset: { categoria: b.cat } };
  if (b.x + wpx > dom.clientWidth + 0.5 || b.y + hpx > dom.clientHeight + 0.5 ||
      colisiona(fantasma, b.x, b.y, wpx, hpx)) {
    error('No se puede rotar: choca o se sale de la bodega'); return;
  }
  b.a = f; b.f = a; b.rot = !b.rot;
  render(); guardarHistorial();
}

/* ============================================================
   RENDER
   ============================================================ */
function render() {
  const bod = $('bodega');
  if (!bod) return;
  bod.querySelectorAll('.bloque-wrapper').forEach(e => e.remove());
  estado.bloques.forEach(b => bod.appendChild(crearElBloque(b)));
  actualizarTotales();
}

function crearElBloque(b) {
  const w = document.createElement('div');
  w.className = 'bloque-wrapper';
  w.dataset.id = b.id;
  w.dataset.categoria = b.cat;
  w.dataset.codigo = b.cod;
  w.dataset.ancho = b.a;
  w.dataset.fondo = b.f;
  w.dataset.alto = b.h;
  if (b.stand) w.dataset.stand = '1';
  w.style.width = (b.a * ESCALA) + 'px';
  w.style.height = (b.f * ESCALA) + 'px';
  w.style.left = b.x + 'px';
  w.style.top = b.y + 'px';
  w.style.zIndex = b.cat === 'libre' ? 0 : (++zTop);
  w.style.setProperty('--fm', Math.max(3, Math.round((b.marca || 0) / 100 * ESCALA)) + 'px');
  w.addEventListener('pointerdown', e => iniciarArrastreBloque(e, b.id));

  const bl = document.createElement('div');
  bl.className = 'bloque';
  bl.style.backgroundColor = b.color;

  const del = document.createElement('button');
  del.className = 'btn-del'; del.type = 'button'; del.textContent = '×'; del.title = 'Eliminar';
  del.addEventListener('pointerdown', e => e.stopPropagation());
  del.addEventListener('click', e => { e.stopPropagation(); borrarBloque(b.id); });
  bl.appendChild(del);

  const rot = document.createElement('button');
  rot.className = 'btn-rot'; rot.type = 'button'; rot.textContent = '↻'; rot.title = 'Girar 90°';
  rot.addEventListener('pointerdown', e => e.stopPropagation());
  rot.addEventListener('click', e => { e.stopPropagation(); rotarBloque(b.id); });
  bl.appendChild(rot);

  if (b.foto && fotos[b.foto]) {
    const fd = document.createElement('div');
    fd.className = 'bloque-foto';
    fd.style.backgroundImage = 'url("' + fotos[b.foto] + '")';
    bl.appendChild(fd);
  }

  const cont = document.createElement('div');
  cont.className = 'bloque-content';
  const s1 = document.createElement('span');
  s1.textContent = (b.cod ? b.cod + ' ' : '') + b.nombre;
  const br = document.createElement('br');
  const s2 = document.createElement('span');
  s2.className = 'area-txt';
  s2.textContent = (b.a * b.f).toFixed(2) + ' m²';
  cont.append(s1, br, s2);

  if (b.stand) {
    const si = document.createElement('div');
    si.className = 'area-txt stand-info';
    si.textContent = textoStand(b);
    cont.appendChild(si);
  }
  if (b.rot) {
    cont.style.transform = 'rotate(90deg)';
    cont.style.position = 'absolute';
    cont.style.width = (b.f * ESCALA) + 'px';
  }
  bl.appendChild(cont);
  w.appendChild(bl);

  if (b.marca) ponerFranja(w, b.marca);
  return w;
}

function ponerFranja(w, cm) {
  const m = Math.max(3, Math.round(cm / 100 * ESCALA));
  ['arriba', 'abajo', 'izq', 'der'].forEach(k => {
    const d = document.createElement('div');
    d.className = 'franja f-' + k;
    d.style.setProperty('--fm', m + 'px');
    w.appendChild(d);
  });
}

/* ============================================================
   ARRASTRE (pointer: ratón y táctil)
   ============================================================ */
let arrastre = null;

function iniciarArrastreBloque(e, id) {
  if (e.button !== undefined && e.button !== 0) return;
  if (e.target.closest('.btn-del, .btn-rot, .ab-ov')) return;
  e.preventDefault();
  const b = estado.bloques.find(x => x.id === id); if (!b) return;
  const w = e.currentTarget;
  const bod = $('bodega');
  const r = bod.getBoundingClientRect();
  const x0 = b.x, y0 = b.y;
  const dx = (e.clientX - r.left) / zoomActual - x0;
  const dy = (e.clientY - r.top) / zoomActual - y0;
  const wpx = b.a * ESCALA, hpx = b.f * ESCALA;
  let nx = x0, ny = y0, movido = false;

  w.classList.add('arrastrando');
  try { w.setPointerCapture(e.pointerId); } catch (_) { }

  const mover = ev => {
    nx = (ev.clientX - r.left) / zoomActual - dx;
    ny = (ev.clientY - r.top) / zoomActual - dy;
    nx = Math.round(nx / SNAP) * SNAP;
    ny = Math.round(ny / SNAP) * SNAP;
    nx = Math.max(0, Math.min(nx, bod.clientWidth - wpx));
    ny = Math.max(0, Math.min(ny, bod.clientHeight - hpx));
    if (nx !== x0 || ny !== y0) movido = true;
    w.style.left = nx + 'px';
    w.style.top = ny + 'px';
  };
  const fin = () => {
    w.removeEventListener('pointermove', mover);
    w.removeEventListener('pointerup', fin);
    w.removeEventListener('pointercancel', fin);
    w.classList.remove('arrastrando');
    if (!movido) { w.style.left = x0 + 'px'; w.style.top = y0 + 'px'; return; }
    const libre = buscarLibre(w, wpx, hpx, nx, ny);
    if (!libre) {
      w.style.left = x0 + 'px'; w.style.top = y0 + 'px';
      error('No hay espacio libre ahí');
      return;
    }
    b.x = libre.x; b.y = libre.y;
    w.style.left = b.x + 'px'; w.style.top = b.y + 'px';
    guardarHistorial();
  };
  w.addEventListener('pointermove', mover);
  w.addEventListener('pointerup', fin);
  w.addEventListener('pointercancel', fin);
}

/* ============================================================
   COLISIONES
   ============================================================ */
function colisiona(el, x, y, w, h) {
  if (el && el.dataset && el.dataset.categoria === 'libre') return false;
  const otros = $('bodega').querySelectorAll('.bloque-wrapper');
  for (const o of otros) {
    if (o === el) continue;
    if (o.dataset.categoria === 'libre') continue;
    const l = parseFloat(o.style.left) || 0, t = parseFloat(o.style.top) || 0;
    const ow = o.offsetWidth, oh = o.offsetHeight;
    if (x < l + ow - 0.01 && x + w > l + 0.01 && y < t + oh - 0.01 && y + h > t + 0.01) return true;
  }
  return false;
}

function buscarLibre(el, w, h, px, py) {
  const bod = $('bodega');
  const maxX = bod.clientWidth - w, maxY = bod.clientHeight - h;
  if (maxX < 0 || maxY < 0) return null;
  if (!colisiona(el, px, py, w, h)) return { x: px, y: py };

  const xs = [], ys = [];
  for (let x = 0; x <= maxX; x += SNAP) xs.push(x);
  for (let y = 0; y <= maxY; y += SNAP) ys.push(y);
  if (xs[xs.length - 1] !== maxX) xs.push(maxX);
  if (ys[ys.length - 1] !== maxY) ys.push(maxY);
  bod.querySelectorAll('.bloque-wrapper').forEach(o => {
    if (o === el) return;
    const l = parseFloat(o.style.left) || 0, t = parseFloat(o.style.top) || 0;
    const ow = o.offsetWidth, oh = o.offsetHeight;
    [l + ow, l - w].forEach(v => { if (v >= 0 && v <= maxX && xs.indexOf(v) < 0) xs.push(v); });
    [t + oh, t - h].forEach(v => { if (v >= 0 && v <= maxY && ys.indexOf(v) < 0) ys.push(v); });
  });

  let mejor = null, mejorD = Infinity;
  for (const y of ys) for (const x of xs) {
    const d = (x - px) * (x - px) + (y - py) * (y - py);
    if (d < mejorD && !colisiona(el, x, y, w, h)) { mejorD = d; mejor = { x, y }; }
  }
  return mejor;
}

/* ============================================================
   TOTALES
   ============================================================ */
function areaOcupada() {
  return estado.bloques.reduce((t, b) => t + (b.cat === 'libre' ? 0 : b.a * b.f), 0);
}

function actualizarTotales() {
  const total = estado.ancho * estado.fondo;
  const ocup = areaOcupada();
  $('txtTotal').textContent = m2(total);
  $('txtOcupada').textContent = m2(ocup);
  $('txtLibre').textContent = m2(total - ocup);
  refrescarDestinos();
  refrescarDuenos();
  dibujarAberturas();
}

/* ============================================================
   ABERTURAS (puertas / ventanas)
   ============================================================ */
function largoDe(a) {
  const horiz = a.pared === 'arriba' || a.pared === 'abajo';
  if (a.dueno === 'bodega') {
    const b = $('bodega');
    return b.style.width ? parseFloat(horiz ? b.style.width : b.style.height) / ESCALA : null;
  }
  const bl = estado.bloques.find(x => x.id === a.dueno);
  return bl ? (horiz ? bl.a : bl.f) : null;
}

function agregarAbertura() {
  const g = id => $(id), n = id => num(g(id).value);
  const a = {
    id: nuevoId('a'),
    dueno: g('abDueno').value,
    pared: g('abPared').value,
    tipo: g('abTipo').value,
    ancho: n('abAncho'), alto: n('abAlto'),
    desde: n('abDesde'),
    pos: g('abPos').value === '' ? null : n('abPos')
  };
  if (a.ancho <= 0 || a.alto <= 0) { error('Pon el ancho y el alto'); return; }
  const largo = largoDe(a);
  if (largo == null) { error('Genera el lienzo primero'); return; }
  const altoMax = a.dueno === 'bodega' ? (num($('altoPared').value, 4))
    : (estado.bloques.find(x => x.id === a.dueno) || {}).h || 2;
  if (a.pos === null) a.pos = Math.max(0, Math.round((largo - a.ancho) / 2 * 100) / 100);
  if (a.pos + a.ancho > largo + 1e-9) { error('No cabe: la pared mide ' + largo.toFixed(2) + ' m'); return; }
  if (a.desde + a.alto > altoMax + 1e-9) { error('Se pasa del alto de la pared (' + altoMax + ' m)'); return; }
  estado.aberturas.push(a);
  listarAb(); dibujarAberturas(); guardarHistorial();
}

function estiloAb(a) {
  const L = a.ancho * ESCALA + 'px', P = a.pos * ESCALA + 'px';
  return {
    arriba: 'left:' + P + ';top:-2px;width:' + L + ';height:4px',
    abajo: 'left:' + P + ';bottom:-2px;width:' + L + ';height:4px',
    izq: 'top:' + P + ';left:-2px;height:' + L + ';width:4px',
    der: 'top:' + P + ';right:-2px;height:' + L + ';width:4px'
  }[a.pared];
}

function dibujarAberturas() {
  document.querySelectorAll('.ab-ov').forEach(e => e.remove());
  const bod = $('bodega');
  if (!bod) return;
  estado.aberturas.forEach(a => {
    const host = a.dueno === 'bodega' ? bod
      : Array.from(bod.querySelectorAll('.bloque-wrapper')).find(w => w.dataset.id === a.dueno);
    if (!host) return;
    const d = document.createElement('div');
    d.className = 'ab-ov ' + a.tipo;
    d.style.cssText = estiloAb(a);
    d.addEventListener('pointerdown', e => iniciarArrastreAb(e, a, d, host));
    host.appendChild(d);
  });
}

function iniciarArrastreAb(e, a, d, host) {
  e.preventDefault(); e.stopPropagation();
  const esBloque = host.classList.contains('bloque-wrapper');
  const bloque = esBloque ? estado.bloques.find(b => b.id === host.dataset.id) : null;
  try { d.setPointerCapture(e.pointerId); } catch (_) { }

  const mover = ev => {
    const r = host.getBoundingClientRect();
    const W = host.clientWidth, H = host.clientHeight;
    const x = (ev.clientX - r.left) / zoomActual, y = (ev.clientY - r.top) / zoomActual;
    const dist = { arriba: y, abajo: H - y, izq: x, der: W - x };
    a.pared = Object.keys(dist).reduce((m, k) => dist[k] < dist[m] ? k : m, 'arriba');
    const horiz = a.pared === 'arriba' || a.pared === 'abajo';
    const largo = (largoDe(a) || 0) * ESCALA, anchoPx = a.ancho * ESCALA;
    const pos = Math.max(0, Math.min((horiz ? x : y) - anchoPx / 2, largo - anchoPx));
    a.pos = Math.round(pos / ESCALA / 0.05) * 0.05;
    d.style.cssText = estiloAb(a);
  };
  const fin = () => {
    d.removeEventListener('pointermove', mover);
    d.removeEventListener('pointerup', fin);
    d.removeEventListener('pointercancel', fin);
    listarAb(); dibujarAberturas(); guardarHistorial();
  };
  d.addEventListener('pointermove', mover);
  d.addEventListener('pointerup', fin);
  d.addEventListener('pointercancel', fin);
  if (bloque) { /* la abertura no mueve el bloque */ }
}

function listarAb() {
  const c = $('listaAb'); c.innerHTML = '';
  estado.aberturas.forEach(a => {
    const d = document.createElement('div');
    d.style.cssText = 'border-bottom:1px solid #eee;padding:5px 0';
    const f1 = document.createElement('div');
    f1.style.cssText = 'display:flex;justify-content:space-between;gap:6px;align-items:center';
    const nombreDueno = a.dueno === 'bodega' ? 'Bodega'
      : ((estado.bloques.find(b => b.id === a.dueno) || {}).nombre || a.dueno);
    const t = document.createElement('span');
    t.textContent = nombreDueno + ' · ' + a.pared + ' · ' + NOM_TIPO[a.tipo] + ' ' + a.ancho + '×' + a.alto;
    const x = document.createElement('button');
    x.type = 'button'; x.textContent = '×'; x.title = 'Quitar';
    x.style.cssText = 'width:26px;padding:0;margin:0;background:#c0392b';
    x.addEventListener('click', () => {
      estado.aberturas = estado.aberturas.filter(z => z.id !== a.id);
      listarAb(); dibujarAberturas(); guardarHistorial();
    });
    f1.append(t, x); d.appendChild(f1);
    const largo = largoDe(a);
    if (largo) {
      const lb = document.createElement('div');
      lb.style.cssText = 'font-size:11px;color:#555';
      lb.textContent = 'Posición: ' + a.pos.toFixed(2) + ' m';
      const r = document.createElement('input');
      r.type = 'range'; r.min = 0; r.max = Math.max(0, largo - a.ancho); r.step = 0.05; r.value = a.pos;
      r.style.cssText = 'width:100%;padding:0';
      r.addEventListener('input', () => {
        a.pos = parseFloat(r.value);
        lb.textContent = 'Posición: ' + a.pos.toFixed(2) + ' m';
        dibujarAberturas();
      });
      r.addEventListener('change', () => guardarHistorial());
      d.append(lb, r);
    }
    c.appendChild(d);
  });
}

function refrescarDuenos() {
  const sel = $('abDueno'); if (!sel) return;
  const prev = sel.value;
  sel.innerHTML = '';
  const o = document.createElement('option');
  o.value = 'bodega'; o.textContent = 'Bodega (paredes exteriores)';
  sel.appendChild(o);
  estado.bloques.filter(b => b.cat === 'edificacion').forEach(b => {
    const op = document.createElement('option');
    op.value = b.id; op.textContent = (b.cod ? b.cod + ' ' : '') + b.nombre;
    sel.appendChild(op);
  });
  sel.value = Array.from(sel.options).some(z => z.value === prev) ? prev : 'bodega';
}

/* ============================================================
   STANDS
   ============================================================ */
function textoStand(b) {
  const area = b.a * b.f;
  const partes = [];
  for (let i = 1; i <= b.stand.niveles; i++) {
    const usado = b.stand.contenido.filter(c => c.nivel === i).reduce((t, c) => t + c.a * c.f, 0);
    partes.push('N' + i + ' ' + Math.round(usado / area * 100) + '%');
  }
  return partes.join(' · ');
}

function meterEnStand(codigo, o) {
  const w = estado.bloques.find(x => x.id === codigo && x.stand);
  if (!w) { error('No se encontró el stand'); return false; }
  const nivel = parseInt($('nivelDestino').value, 10) || 1;
  const cont = w.stand.contenido.filter(c => c.nivel === nivel);
  if (o.h > w.stand.altoNivel) { error('No cabe: el alto (' + o.h + ' m) supera el nivel (' + w.stand.altoNivel + ' m)'); return false; }
  if (cont.reduce((t, c) => t + c.a * c.f, 0) + o.a * o.f > w.a * w.f + 1e-9) {
    error('No cabe: se pasa del área del nivel ' + nivel); return false;
  }
  if (w.stand.carga && cont.reduce((t, c) => t + c.peso, 0) + o.peso > w.stand.carga) {
    error('No cabe: se pasa de la carga del nivel ' + nivel); return false;
  }
  w.stand.contenido.push({ nombre: o.nombre, a: o.a, f: o.f, h: o.h, peso: o.peso, nivel });
  ok(o.nombre + ' → nivel ' + nivel);
  return true;
}

function refrescarDestinos() {
  const sel = $('destino'); if (!sel) return;
  const prev = sel.value;
  sel.innerHTML = '';
  const o = document.createElement('option');
  o.value = ''; o.textContent = '— En la bodega —';
  sel.appendChild(o);
  estado.bloques.filter(b => b.stand).forEach(b => {
    const op = document.createElement('option');
    op.value = b.id; op.textContent = (b.cod ? b.cod + ' ' : '') + b.nombre;
    sel.appendChild(op);
  });
  sel.value = Array.from(sel.options).some(z => z.value === prev) ? prev : '';
  refrescarNiveles();
}

function refrescarNiveles() {
  const v = $('destino').value, sn = $('nivelDestino');
  const w = estado.bloques.find(b => b.id === v && b.stand);
  const prev = sn.value;
  sn.innerHTML = '';
  $('nivelWrap').style.display = w ? 'block' : 'none';
  if (w) {
    for (let i = 1; i <= w.stand.niveles; i++) {
      const op = document.createElement('option');
      op.value = i; op.textContent = 'Nivel ' + i;
      sn.appendChild(op);
    }
    if (prev) sn.value = prev;
  }
}

/* ============================================================
   LEYENDA / IMPRESIÓN
   ============================================================ */
function prepararImpresion() {
  const b = $('bodega');
  if (!b.style.width) return;
  const bw = parseFloat(b.style.width) + 4, bh = parseFloat(b.style.height) + 4;
  const vertical = bh >= bw;
  const legend = $('leyenda');
  const legendPx = (legend && legend.offsetWidth) ? legend.offsetWidth + 18 : 340;
  const W = (vertical ? 215.9 : 279.4) - 20, H = (vertical ? 279.4 : 215.9) - 20;
  const pxW = (W / 25.4 * 96 * 0.98) - legendPx;
  const pxH = H / 25.4 * 96 * 0.98;
  const z = Math.max(0.05, Math.min(pxW / bw, pxH / bh));
  let st = $('printDinamico');
  if (!st) { st = document.createElement('style'); st.id = 'printDinamico'; document.head.appendChild(st); }
  st.textContent =
    '@page { size: letter ' + (vertical ? 'portrait' : 'landscape') + '; margin: 10mm; } ' +
    '@media print { #wrapper { zoom: ' + z.toFixed(4) + '; } } ' +
    '@supports not (zoom: 1) { @media print { #wrapper { transform: scale(' + z.toFixed(4) + '); transform-origin: top left; } } }';
}

function construirLeyenda() {
  const cont = $('leyenda');
  cont.innerHTML = '';
  if (!estado.ancho) return;
  const el = (tag, txt, cls) => {
    const e = document.createElement(tag);
    if (txt !== undefined) e.textContent = txt;
    if (cls) e.className = cls;
    return e;
  };
  const fila = (tr, txt, cls) => { const td = el('td', txt, cls); tr.appendChild(td); return td; };

  cont.appendChild(el('h3', 'CONVENCIONES'));
  const res = el('table');
  [['Bodega', estado.ancho.toFixed(2) + ' × ' + estado.fondo.toFixed(2) + ' m'],
   ['Área total', m2(estado.ancho * estado.fondo)],
   ['Área ocupada', m2(areaOcupada())],
   ['Área libre', m2(estado.ancho * estado.fondo - areaOcupada())]].forEach(r => {
    const tr = el('tr'); fila(tr, r[0]); fila(tr, r[1], 'num'); res.appendChild(tr);
  });
  cont.appendChild(res);

  if (!estado.bloques.length) { cont.appendChild(el('p', 'Sin elementos en el plano.')); return; }

  [['libre', 'ESPACIOS LIBRES (PASILLOS / ZONA PEATONAL)'],
   ['objeto', 'OBJETOS'],
   ['edificacion', 'EDIFICACIONES']].forEach(([clave, titulo]) => {
    const items = estado.bloques.filter(w => w.cat === clave);
    if (!items.length) return;
    cont.appendChild(el('h4', titulo + ' (' + items.length + ')'));
    const t = el('table'); const th = el('tr');
    ['Color', 'Nombre', 'Medidas (m)', 'Área'].forEach((x, i) => th.appendChild(el('th', x, i > 1 ? 'num' : '')));
    t.appendChild(th);
    let sub = 0;
    items.forEach(w => {
      const area = w.a * w.f;
      const tr = el('tr');
      const tdc = el('td');
      const mu = el('span', '', 'muestra');
      mu.style.backgroundColor = w.color;
      tdc.appendChild(mu); tr.appendChild(tdc);
      fila(tr, (w.cod ? w.cod + ' ' : '') + w.nombre);
      fila(tr, w.a.toFixed(2) + ' × ' + w.f.toFixed(2) + (clave !== 'libre' ? ' × ' + w.h.toFixed(2) : ''), 'num');
      fila(tr, m2(area), 'num');
      t.appendChild(tr); sub += area;
      if (w.stand) {
        w.stand.contenido.forEach(c => {
          const r = el('tr');
          fila(r, '');
          fila(r, '↳ N' + c.nivel + ' · ' + c.nombre);
          fila(r, c.a.toFixed(2) + ' × ' + c.f.toFixed(2) + ' × ' + c.h.toFixed(2) + (c.peso ? ' · ' + c.peso + ' kg' : ''), 'num');
          fila(r, m2(c.a * c.f), 'num');
          t.appendChild(r);
        });
      }
    });
    const ts = el('tr', undefined, 'sub');
    fila(ts, ''); fila(ts, 'Subtotal'); fila(ts, ''); fila(ts, m2(sub), 'num');
    t.appendChild(ts);
    cont.appendChild(t);
  });

  if (estado.aberturas.length) {
    cont.appendChild(el('h4', 'PUERTAS Y VENTANAS (' + estado.aberturas.length + ')'));
    const ta = el('table'), th2 = el('tr');
    ['En / pared', 'Medidas (m)', 'Tipo'].forEach((x, i) => th2.appendChild(el('th', x, i ? 'num' : '')));
    ta.appendChild(th2);
    estado.aberturas.forEach(a => {
      const r = el('tr');
      const nom = a.dueno === 'bodega' ? 'Bodega'
        : ((estado.bloques.find(b => b.id === a.dueno) || {}).nombre || '—');
      fila(r, nom + ' · ' + { arriba: 'arriba', abajo: 'abajo', izq: 'izquierda', der: 'derecha' }[a.pared]);
      fila(r, a.ancho.toFixed(2) + ' × ' + a.alto.toFixed(2) + (a.desde ? ' · a ' + a.desde.toFixed(2) + ' del piso' : ''), 'num');
      fila(r, NOM_TIPO[a.tipo], 'num');
      ta.appendChild(r);
    });
    cont.appendChild(ta);
  }

  const tt = el('table'); const tr = el('tr', undefined, 'total');
  fila(tr, 'TOTAL OCUPADO'); fila(tr, m2(areaOcupada()), 'num');
  tt.appendChild(tr); cont.appendChild(tt);
}

function imprimir() {
  construirLeyenda();
  // deja que el navegador aplique los estilos de la leyenda antes de calcular la escala
  requestAnimationFrame(() => setTimeout(() => { prepararImpresion(); window.print(); }, 60));
}

/* ============================================================
   VISTA 3D
   ============================================================ */
function cara(w, h, transform, estilo, html) {
  const c = document.createElement('div');
  c.className = 'cara3d';
  c.style.width = w + 'px';
  c.style.height = h + 'px';
  c.style.transform = transform;
  Object.assign(c.style, estilo || {});
  if (html) c.innerHTML = html;
  return c;
}

function aplicarCamara() {
  cam.rx = Math.max(-90, Math.min(-5, cam.rx));
  cam.z = Math.max(0.2, Math.min(6, cam.z));
  $('escena3d').style.transform =
    'scale(' + cam.z + ') rotateX(' + cam.rx + 'deg) rotateY(' + cam.ry + 'deg) translate3d(' +
    (-mundoW / 2) + 'px, 0px, ' + (-mundoF / 2) + 'px)';
}

function abrir3D() {
  if (!estado.ancho) { error('Genera el lienzo'); return; }
  const mundo = $('mundo3d'); mundo.innerHTML = '';
  mundoW = estado.ancho * ESCALA; mundoF = estado.fondo * ESCALA;

  mundo.appendChild(cara(mundoW, mundoF, 'rotateX(90deg)', {
    transformOrigin: '0 0', backgroundColor: '#b9bdc1', outline: '2px solid #333',
    backgroundImage: 'linear-gradient(to right, rgba(0,0,0,.16) 1px, transparent 1px), linear-gradient(to bottom, rgba(0,0,0,.16) 1px, transparent 1px)',
    backgroundSize: ESCALA + 'px ' + ESCALA + 'px', backgroundRepeat: 'repeat'
  }));

  const hP = (num($('altoPared').value, 4)) * ESCALA;
  const colP = $('colorPared').value;
  const ajuste = $('ajustePared').value;
  const pared = (w, tr, clave, br) => {
    const e = {
      backgroundColor: colP, filter: 'brightness(' + br + ')',
      backfaceVisibility: 'hidden', outline: 'none',
      borderBottom: '3px solid rgba(0,0,0,.35)'
    };
    if (fotosPared[clave]) { e.backgroundImage = 'url("' + fotosPared[clave] + '")'; e.backgroundSize = ajuste; }
    const largo = (clave === 'arriba' || clave === 'abajo' ? mundoW : mundoF) / ESCALA;
    mundo.appendChild(cara(w, hP, tr, e, abHTML('bodega', clave, largo, hP, clave === 'abajo' || clave === 'izq')));
  };
  pared(mundoW, 'translate3d(0px, ' + (-hP) + 'px, 0px)', 'arriba', 1);
  pared(mundoW, 'translate3d(0px, ' + (-hP) + 'px, ' + mundoF + 'px) rotateY(180deg)', 'abajo', 0.95);
  pared(mundoF, 'translate3d(' + (-mundoF / 2) + 'px, ' + (-hP) + 'px, ' + (mundoF / 2) + 'px) rotateY(90deg)', 'izq', 0.85);
  pared(mundoF, 'translate3d(' + (mundoW - mundoF / 2) + 'px, ' + (-hP) + 'px, ' + (mundoF / 2) + 'px) rotateY(-90deg)', 'der', 0.9);

  estado.bloques.forEach(b => {
    const l = b.x, t = b.y, w = b.a * ESCALA, d = b.f * ESCALA;
    const esMarca = b.cat === 'libre';
    const h = (esMarca ? 0.05 : b.h) * ESCALA;
    const medidas = b.a.toFixed(2) + ' × ' + b.f.toFixed(2) + (esMarca ? '' : ' × ' + b.h.toFixed(2)) + ' m';
    const base = { backgroundColor: b.color };
    const lado = br => {
      const e = Object.assign({}, base, { filter: 'brightness(' + br + ')' });
      if (b.foto && fotos[b.foto]) e.backgroundImage = 'url("' + fotos[b.foto] + '")';
      return e;
    };
    mundo.appendChild(cara(w + 14, d + 14, 'translate3d(' + (l - 7) + 'px, -0.5px, ' + (t - 7) + 'px) rotateX(90deg)', {
      transformOrigin: '0 0', background: 'rgba(0,0,0,.38)', filter: 'blur(5px)', outline: 'none', borderRadius: '6px'
    }));
    if (b.estante) { dibujarEstante(mundo, b, l, t, w, d, h); return; }
    // solo rotulamos la cara superior si el equipo es grande (si no, se solapan los textos)
    const etiqueta = (b.a * b.f >= 1.4)
      ? '<span>' + escapar(b.nombre) + '<br>' + medidas + '</span>' : '';
    mundo.appendChild(cara(w, d, 'translate3d(' + l + 'px, ' + (-h) + 'px, ' + t + 'px) rotateX(90deg)',
      Object.assign({}, base, { transformOrigin: '0 0' }), etiqueta));
    mundo.appendChild(cara(w, h, 'translate3d(' + l + 'px, ' + (-h) + 'px, ' + (t + d) + 'px)', lado(1), abHTML(b.id, 'abajo', b.a, h, false)));
    mundo.appendChild(cara(w, h, 'translate3d(' + l + 'px, ' + (-h) + 'px, ' + t + 'px) rotateY(180deg)', lado(0.7), abHTML(b.id, 'arriba', b.a, h, true)));
    mundo.appendChild(cara(d, h, 'translate3d(' + (l - d / 2) + 'px, ' + (-h) + 'px, ' + (t + d / 2) + 'px) rotateY(-90deg)', lado(0.85), abHTML(b.id, 'izq', b.f, h, false)));
    mundo.appendChild(cara(d, h, 'translate3d(' + (l + w - d / 2) + 'px, ' + (-h) + 'px, ' + (t + d / 2) + 'px) rotateY(90deg)', lado(0.65), abHTML(b.id, 'der', b.f, h, true)));
  });

  const diag = Math.sqrt(mundoW * mundoW + mundoF * mundoF) || 1;
  cam = { rx: -55, ry: -25, z: Math.min(2, 0.8 * Math.min(window.innerWidth, window.innerHeight) / diag) };
  aplicarCamara();
  $('vista3d').classList.add('activa');
  $('btnCerrar3D').focus();
}

function escapar(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function abHTML(dueno, pared, largoM, altoPx, flip) {
  return estado.aberturas.filter(a => a.dueno === dueno && a.pared === pared).map(a => {
    const x = (flip ? largoM - a.pos - a.ancho : a.pos) * ESCALA;
    const y = altoPx - (a.desde + a.alto) * ESCALA;
    const col = { puerta: '#8b5a2b', ventana: 'rgba(93,173,226,.75)', hueco: '#2c3e50' }[a.tipo];
    return '<div style="position:absolute;left:' + x + 'px;top:' + y + 'px;width:' + (a.ancho * ESCALA) +
      'px;height:' + (a.alto * ESCALA) + 'px;background:' + col +
      ';border:1px solid rgba(0,0,0,.6);box-sizing:border-box"></div>';
  }).join('');
}

function caja3D(mundo, x, z, w, d, y0, hh, color) {
  const top = -(y0 + hh);
  const est = br => ({ backgroundColor: color, filter: 'brightness(' + br + ')', outline: 'none' });
  mundo.appendChild(cara(w, d, 'translate3d(' + x + 'px, ' + top + 'px, ' + z + 'px) rotateX(90deg)', Object.assign(est(1.1), { transformOrigin: '0 0' })));
  mundo.appendChild(cara(w, hh, 'translate3d(' + x + 'px, ' + top + 'px, ' + (z + d) + 'px)', est(1)));
  mundo.appendChild(cara(w, hh, 'translate3d(' + x + 'px, ' + top + 'px, ' + z + 'px) rotateY(180deg)', est(0.7)));
  mundo.appendChild(cara(d, hh, 'translate3d(' + (x - d / 2) + 'px, ' + top + 'px, ' + (z + d / 2) + 'px) rotateY(-90deg)', est(0.85)));
  mundo.appendChild(cara(d, hh, 'translate3d(' + (x + w - d / 2) + 'px, ' + top + 'px, ' + (z + d / 2) + 'px) rotateY(90deg)', est(0.65)));
}

function dibujarEstante(mundo, b, l, t, w, d, h) {
  const p = Math.max(1.6, 0.05 * ESCALA), e = Math.max(1, 0.03 * ESCALA);
  const n = b.estante.repisas;
  [[l, t], [l + w - p, t], [l, t + d - p], [l + w - p, t + d - p]].forEach(c => caja3D(mundo, c[0], c[1], p, p, 0, h, '#566573'));
  for (let i = 0; i < n; i++) caja3D(mundo, l, t, w, d, (b.estante.h0 + i * b.estante.sep) * ESCALA, e, '#aeb6bf');
}

function cerrar3D() { $('vista3d').classList.remove('activa'); }

/* ============================================================
   PERSISTENCIA
   ============================================================ */
function guardarLocal() {
  try {
    localStorage.setItem(LS_KEY, JSON.stringify({
      ancho: estado.ancho, fondo: estado.fondo,
      bloques: estado.bloques, aberturas: estado.aberturas
    }));
  } catch (_) { /* cuota llena o modo privado: se ignora */ }
}

function cargarLocal() {
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (!raw) return false;
    const d = JSON.parse(raw);
    if (!d || !d.ancho) return false;
    estado = { ancho: d.ancho, fondo: d.fondo, bloques: d.bloques || [], aberturas: d.aberturas || [] };
    return true;
  } catch (_) { return false; }
}

function aplicarEstado() {
  const b = $('bodega');
  montarReglas();
  b.style.width = (estado.ancho * ESCALA) + 'px';
  b.style.height = (estado.fondo * ESCALA) + 'px';
  $('anchoBodega').value = estado.ancho;
  $('fondoBodega').value = estado.fondo;
  $('regla-x').style.width = (estado.ancho * ESCALA) + 'px';
  $('regla-y').style.height = (estado.fondo * ESCALA) + 'px';
  dibujarReglas(estado.ancho, estado.fondo);
  render();
  listarAb();
  prepararImpresion();
}

function exportarJSON() {
  const data = { version: 1, ancho: estado.ancho, fondo: estado.fondo, bloques: estado.bloques, aberturas: estado.aberturas, fotos };
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'plano-' + new Date().toISOString().slice(0, 10) + '.json';
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  ok('Proyecto exportado');
}

function importarJSON(file) {
  const r = new FileReader();
  r.onload = () => {
    try {
      const d = JSON.parse(r.result);
      if (!d.ancho || !Array.isArray(d.bloques)) throw new Error('formato');
      estado = { ancho: d.ancho, fondo: d.fondo, bloques: d.bloques, aberturas: d.aberturas || [] };
      if (d.fotos) Object.assign(fotos, d.fotos);
      historial = []; histIdx = -1;
      aplicarEstado(); guardarHistorial();
      ok('Proyecto importado');
    } catch (e) { error('El archivo no es un proyecto válido'); }
  };
  r.readAsText(file);
}

/* ============================================================
   INICIALIZACIÓN
   ============================================================ */
function iniciar() {
  // listeners (sin onclick inline)
  $('btnCrearBodega').addEventListener('click', () => crearBodega());
  $('btnAgregar').addEventListener('click', agregarBloque);
  $('btnDeshacer').addEventListener('click', deshacer);
  $('btn3D').addEventListener('click', abrir3D);
  $('btnCerrar3D').addEventListener('click', cerrar3D);
  $('btnImprimir').addEventListener('click', imprimir);
  $('btnMenos').addEventListener('click', () => cambiarZoom(-0.1));
  $('btnMas').addEventListener('click', () => cambiarZoom(0.1));
  $('btnAgregarAb').addEventListener('click', agregarAbertura);
  $('btnExportar').addEventListener('click', exportarJSON);
  $('btnImportar').addEventListener('click', () => $('fileImportar').click());
  $('fileImportar').addEventListener('change', e => {
    const f = e.target.files && e.target.files[0];
    if (f) importarJSON(f);
    e.target.value = '';
  });
  $('btnBorrarTodo').addEventListener('click', () => {
    if (!confirm('¿Borrar todo el plano?')) return;
    estado = { ancho: estado.ancho, fondo: estado.fondo, bloques: [], aberturas: [] };
    render(); listarAb(); guardarHistorial();
  });

  $('categoriaBloque').addEventListener('change', cambiarCategoria);
  $('esStand').addEventListener('change', e => { $('standCampos').style.display = e.target.checked ? 'flex' : 'none'; });
  $('esEstante').addEventListener('change', e => { $('estanteCampos').style.display = e.target.checked ? 'flex' : 'none'; });
  $('pasoMover').addEventListener('change', e => { SNAP = parseInt(e.target.value, 10) || 20; });
  $('destino').addEventListener('change', refrescarNiveles);
  ['fotoParedArriba', 'fotoParedAbajo', 'fotoParedIzq', 'fotoParedDer'].forEach(id => {
    const el = $(id); if (el) el.addEventListener('change', () => cargarPared(el));
  });

  // panel móvil
  const panel = $('panel');
  $('btn-panel').addEventListener('click', () => {
    const abierto = panel.classList.toggle('abierto');
    $('btn-panel').setAttribute('aria-expanded', abierto ? 'true' : 'false');
  });

  window.addEventListener('beforeprint', construirLeyenda);
  window.addEventListener('resize', () => { });
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape') cerrar3D();
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') { e.preventDefault(); deshacer(); }
  });

  // 3D: girar y zoom
  const v = $('vista3d'); let arrastrando = false, ux = 0, uy = 0;
  v.addEventListener('pointerdown', e => {
    if (e.target.closest('#barra3d')) return;
    arrastrando = true; ux = e.clientX; uy = e.clientY;
    try { v.setPointerCapture(e.pointerId); } catch (_) { }
  });
  v.addEventListener('pointermove', e => {
    if (!arrastrando) return;
    cam.ry += (e.clientX - ux) * 0.4;
    cam.rx -= (e.clientY - uy) * 0.3;
    ux = e.clientX; uy = e.clientY;
    aplicarCamara();
  });
  v.addEventListener('pointerup', () => { arrastrando = false; });
  v.addEventListener('pointercancel', () => { arrastrando = false; });
  v.addEventListener('wheel', e => { e.preventDefault(); cam.z *= Math.exp(-e.deltaY * 0.001); aplicarCamara(); }, { passive: false });

  cambiarCategoria();

  // restaurar sesión anterior
  if (cargarLocal()) {
    aplicarEstado();
    historial = []; histIdx = -1;
    guardarHistorial();
  } else {
    crearBodega(estado.ancho, estado.fondo, true);
  }

  if (new URLSearchParams(location.search).has('selftest')) correrTest();
}

function cambiarCategoria() {
  const c = $('categoriaBloque').value;
  $('colorBloque').value = COLORES[c];
  $('optObjeto').style.display = c === 'objeto' ? 'block' : 'none';
}

/* ============================================================
   AUTO-TEST (?selftest=1)
   ============================================================ */
function correrTest() {
  const cont = $('selftest');
  cont.hidden = false;
  const res = [];
  const t = (nombre, fn) => {
    try { const r = fn(); res.push((r ? 'PASS' : 'FAIL') + ' · ' + nombre); }
    catch (e) { res.push('FAIL · ' + nombre + ' (' + e.message + ')'); }
  };

  t('crear bodega 10.13x20.45', () => {
    crearBodega(10.13, 20.45, true);
    return Math.abs(estado.ancho * estado.fondo - 207.1585) < 1e-6 && estado.bloques.length === 0;
  });

  t('historial sembrado (deshacer disponible)', () => histIdx === 0);

  t('agregar bloque EQ1', () => {
    $('nombreBloque').value = 'Horno test';
    $('anchoBloque').value = 2; $('fondoBloque').value = 1; $('altoBloque').value = 2;
    agregarBloque();
    return estado.bloques.length === 1 && estado.bloques[0].cod === 'EQ1';
  });

  t('área ocupada = 2 m²', () => Math.abs(areaOcupada() - 2) < 1e-9);

  t('sin solape: segundo bloque se reubica', () => {
    $('nombreBloque').value = 'Equipo 2';
    agregarBloque();
    if (estado.bloques.length !== 2) return false;
    const [a, b] = estado.bloques;
    const solapa = a.x < b.x + b.a * ESCALA - 0.01 && a.x + a.a * ESCALA > b.x + 0.01 &&
                   a.y < b.y + b.f * ESCALA - 0.01 && a.y + a.f * ESCALA > b.y + 0.01;
    return !solapa;
  });

  t('deshacer quita el último', () => {
    const antes = estado.bloques.length;
    deshacer();
    return estado.bloques.length === antes - 1;
  });

  t('deshacer hasta vacío', () => {
    while (histIdx > 0) deshacer();
    return estado.bloques.length === 0;
  });

  t('abertura válida', () => {
    $('abPared').value = 'abajo'; $('abAncho').value = 1; $('abAlto').value = 2.1; $('abDesde').value = 0; $('abPos').value = '';
    agregarAbertura();
    return estado.aberturas.length === 1 && estado.aberturas[0].pos > 0;
  });

  t('abertura que no cabe se rechaza', () => {
    $('abAncho').value = 99;
    agregarAbertura();
    return estado.aberturas.length === 1;
  });

  t('stand: meter objeto dentro', () => {
    $('esStand').checked = true;
    $('categoriaBloque').value = 'objeto';
    $('nombreBloque').value = 'Stand test';
    $('anchoBloque').value = 2; $('fondoBloque').value = 1; $('altoBloque').value = 1;
    agregarBloque();
    const stand = estado.bloques.find(b => b.stand);
    if (!stand) return false;
    refrescarDestinos();
    $('destino').value = stand.id; refrescarNiveles();
    $('nombreBloque').value = 'Caja'; $('anchoBloque').value = 0.5; $('fondoBloque').value = 0.5; $('altoBloque').value = 0.5;
    agregarBloque();
    $('esStand').checked = false;
    return stand.stand.contenido.length === 1;
  });

  t('leyenda genera tablas', () => {
    construirLeyenda();
    return $('leyenda').querySelectorAll('table').length > 0;
  });

  t('escala de impresión calculada', () => {
    prepararImpresion();
    const st = $('printDinamico');
    return !!st && /zoom:\s*\d*\.\d+/.test(st.textContent);
  });

  t('exportar/importar JSON (round-trip)', () => {
    const copia = JSON.stringify({ version: 1, ancho: estado.ancho, fondo: estado.fondo, bloques: estado.bloques, aberturas: estado.aberturas, fotos });
    const d = JSON.parse(copia);
    return d.bloques.length === estado.bloques.length && d.aberturas.length === estado.aberturas.length;
  });

  t('no hay bloques fuera de la bodega', () => {
    const W = estado.ancho * ESCALA, H = estado.fondo * ESCALA;
    return estado.bloques.every(b => b.x >= 0 && b.y >= 0 && b.x + b.a * ESCALA <= W + 0.5 && b.y + b.f * ESCALA <= H + 0.5);
  });

  t('franja de marcaci\u00f3n dibujada', () => {
    $('nombreBloque').value = 'Con franja'; $('anchoBloque').value = 1; $('fondoBloque').value = 1;
    $('conMarca').checked = true; agregarBloque();
    return document.querySelectorAll('.franja').length >= 4;
  });

  t('vista 3D genera caras', () => {
    abrir3D();
    const n = document.querySelectorAll('.cara3d').length;
    cerrar3D();
    return n > 10;
  });

  cont.textContent = res.join('\n');
  document.title = (res.some(r => r.startsWith('FAIL')) ? 'FAIL ' : 'OK ') + res.filter(r => r.startsWith('PASS')).length + '/' + res.length;
}

/* arranque */
if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', iniciar);
else iniciar();
