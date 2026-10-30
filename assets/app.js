/* ============================================================
   Simulador de Planta CTC Energy  ·  app.js
   Modelo -> render. Sin dependencias.
   ============================================================ */
'use strict';

/* ---------------- constantes ---------------- */
const VERSION = '1.4';
const ESCALA = 20;                 // px por metro
const LS_KEY = 'ctc_simulador_v1';
const LS_PROY = 'ctc_proyecto_v2';
const LS_BIB = 'ctc_biblioteca_v1';
const MAX_HIST = 40;
const NOM_TIPO = { puerta: 'Puerta', ventana: 'Ventana', hueco: 'Abertura sin puerta' };
const COLORES = { objeto: '#f1c40f', edificacion: '#3498db', muro: '#5d6d7e', libre: '#7dcea0', marca: '#f1c40f' };
const MODO_TEST = new URLSearchParams(location.search).has('selftest') ||
                  new URLSearchParams(location.search).has('test');

/* ---------------- estado ---------------- */
let estado = {
    version: 2, ancho: 10.13, fondo: 20.45,
    bloques: [], aberturas: [], recintos: [],
    altoPared: 4, cubierta: 'plana', alturaCumbrera: 6, colorPared: '#e6e2da',
    imgParedesCompletas: false
};
let nombreProyecto = 'Taller CTC Energy';
let SNAP = 2;
let zoomActual = 1;
let zTop = 1;
let idSeq = 0;

const fotos = {};                  // id -> dataURL (no se duplica en el historial)
const LS_FOTOS = 'ctc_simulador_fotos_v1';

function guardarFotosLocal() {
  try { localStorage.setItem(LS_FOTOS, JSON.stringify(fotos)); } catch (_) { /* cuota llena */ }
}
function cargarFotosLocal() {
  try {
    const raw = localStorage.getItem(LS_FOTOS);
    if (raw) Object.assign(fotos, JSON.parse(raw));
  } catch (_) { }
}
let fotoSeq = 0;
const fotosPared = {};

let historial = [];
let histIdx = -1;

let cam = { rx: -55, ry: -25, z: 1 };
let mundoW = 0, mundoF = 0;
let sprites = [];
let imagenCache = null;
let vivo3dAbierto = false, vivoGiro = 0, vivoZoom = 1, vivoToken = 0, vivoTimer = null, vivoDrag = null;
let vivoPunteros = new Map(), vivoPinch = null;
let fotoPendiente = null;
let bibExtra = [], bibOcultos = [];

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
  imagenCache = null;
  const s = JSON.stringify(estado);
  if (histIdx >= 0 && JSON.stringify(historial[histIdx]) === s) { guardarLocal(); return; }
  historial = historial.slice(0, histIdx + 1);
  historial.push(JSON.parse(s));
  histIdx = historial.length - 1;
  if (historial.length > MAX_HIST) { historial.shift(); histIdx--; }
  guardarLocal();
  programarVivo3D();
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

  sincronizarExtras();
  estado = {
    version: 2, ancho, fondo, bloques: [], aberturas: [], recintos: [],
    altoPared: estado.altoPared, cubierta: estado.cubierta,
    alturaCumbrera: estado.alturaCumbrera, colorPared: estado.colorPared,
    imgParedesCompletas: !!estado.imgParedesCompletas
  };
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

function recortarFondo(url, cb) {
  const img = new Image();
  img.onload = () => {
    try {
      const c = document.createElement('canvas');
      c.width = img.width; c.height = img.height;
      const ctx = c.getContext('2d');
      ctx.drawImage(img, 0, 0);
      const d = ctx.getImageData(0, 0, c.width, c.height);
      const px = d.data;
      const corners = [[0, 0], [c.width - 1, 0], [0, c.height - 1], [c.width - 1, c.height - 1]];
      let r = 0, g = 0, b = 0;
      corners.forEach(([x, y]) => {
        const i = (y * c.width + x) * 4;
        r += px[i]; g += px[i + 1]; b += px[i + 2];
      });
      r /= 4; g /= 4; b /= 4;
      const tol = 46;
      for (let i = 0; i < px.length; i += 4) {
        const dr = px[i] - r, dg = px[i + 1] - g, db = px[i + 2] - b;
        if (Math.sqrt(dr * dr + dg * dg + db * db) < tol) px[i + 3] = 0;
      }
      ctx.putImageData(d, 0, 0);
      cb(c.toDataURL('image/png'));
    } catch (e) { cb(null); }
  };
  img.onerror = () => cb(null);
  img.src = url;
}

function cargarPared(inp) {
  const clave = inp.dataset.pared;
  const f = inp.files && inp.files[0];
  if (!f) return;
  cargarFoto(f, url => {
    if (url) {
      fotosPared[clave] = url;
      marcarFotoPared(clave, true);
      ok('Foto de pared cargada');
    } else {
      error('No se pudo leer la foto');
    }
    inp.value = '';            // permite volver a elegir el mismo archivo
  }, 1600);
}

function marcarFotoPared(clave, tiene) {
  const btn = document.querySelector('[data-quitar="' + clave + '"]');
  if (btn) btn.classList.toggle('off', !tiene);
}

function quitarFotoPared(clave) {
  delete fotosPared[clave];
  const inp = document.querySelector('input[data-pared="' + clave + '"]');
  if (inp) inp.value = '';
  marcarFotoPared(clave, false);
  aviso('Foto quitada');
}

function limpiarFotosPared() {
  Object.keys(fotosPared).forEach(k => delete fotosPared[k]);
  ['arriba', 'abajo', 'izq', 'der'].forEach(k => {
    const inp = document.querySelector('input[data-pared="' + k + '"]');
    if (inp) inp.value = '';
    marcarFotoPared(k, false);
  });
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
  b.marca = null;
  b.marcaColor = 'amarillo-negro';
  b.marcaForma = 'perimetro';
  if (cat === 'objeto' && $('conMarca').checked) {
    b.marca = anchoMarcaActual();
    if ($('marcaColor')) b.marcaColor = $('marcaColor').value;
    if ($('marcaForma')) b.marcaForma = $('marcaForma').value;
  }
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
  const pre = { objeto: 'EQ', edificacion: 'E', muro: 'MD', libre: 'MA', marca: 'MM' }[cat] || 'EQ';
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

  const seguir = (fotoUrl, silueta) => {
    const ed = dentroSeleccionado();
    if (ed && b.cat !== 'libre' && b.cat !== 'edificacion') {
      colocarDentroDe(ed, b, cant, fotoUrl, silueta);
      return;
    }
    if (destino && b.cat !== 'libre') {
      let n = 0;
      for (let i = 0; i < cant; i++) {
        const copia = JSON.parse(JSON.stringify(b));
        copia.id = nuevoId('b');
        if (!meterEnStand(destino, copia)) break;
        n++;
      }
      if (n) { render(); guardarHistorial(); $('nombreBloque').value = ''; }
      return;
    }
    iniciarColocacion(b, cant, fotoUrl, silueta);
  };

  if (!file && fotoPendiente) {
    const f = fotoPendiente;
    fotoPendiente = null;
    seguir(f, true);
    return;
  }
  if (!file) { seguir(null, false); return; }
  cargarFoto(file, url => {
    if (url && $('fotoSilueta') && $('fotoSilueta').checked) {
      recortarFondo(url, out => seguir(out || url, !!out));
    } else {
      seguir(url, false);
    }
  }, 900);
}

/* ---------- modo colocación: se hace clic donde uno quiere ---------- */
let colocando = null;

function iniciarColocacion(b, cant, fotoUrl, silueta) {
  cancelarColocacion();
  cerrarPanelSiMovil();
  colocando = { b: b, cant: cant, restantes: cant, foto: fotoUrl, silueta: !!silueta };
  document.body.classList.add('colocando');
  const bod = $('bodega');
  const g = document.createElement('div');
  g.id = 'fantasma';
  g.style.width = (b.a * ESCALA) + 'px';
  g.style.height = (b.f * ESCALA) + 'px';
  g.style.left = '0px';
  g.style.top = '0px';
  bod.appendChild(g);
  colocando.ghost = g;
  aviso('Haz clic en el plano para ubicar' +
        (cant > 1 ? ' (' + cant + ' unidades)' : '') + ' · Esc para cancelar');
}

function cancelarColocacion() {
  if (!colocando) return;
  const g = colocando.ghost;
  if (g && g.parentNode) g.parentNode.removeChild(g);
  colocando = null;
  document.body.classList.remove('colocando');
}

function moverFantasma(ev) {
  if (!colocando) return;
  const bod = $('bodega'), r = bod.getBoundingClientRect();
  const wpx = colocando.b.a * ESCALA, hpx = colocando.b.f * ESCALA;
  let x = (ev.clientX - r.left) / zoomActual - wpx / 2;
  let y = (ev.clientY - r.top) / zoomActual - hpx / 2;
  x = Math.round(x / SNAP) * SNAP;
  y = Math.round(y / SNAP) * SNAP;
  x = Math.max(0, Math.min(x, bod.clientWidth - wpx));
  y = Math.max(0, Math.min(y, bod.clientHeight - hpx));
  colocando.ghost.style.left = x + 'px';
  colocando.ghost.style.top = y + 'px';
}

function colocarEnPunto(px, py) {
  const c = colocando; if (!c) return false;
  const b = JSON.parse(JSON.stringify(c.b));
  b.id = nuevoId('b');
  if (b.cat !== 'libre' && areaOcupada() + b.a * b.f > estado.ancho * estado.fondo + 1e-9) {
    error('No cabe: se pasa del área total');
    return false;
  }
  b.cod = siguienteCodigo(b.cat);
  if (c.foto) {
    const fid = 'f' + (++fotoSeq);
    fotos[fid] = c.foto;
    b.foto = fid;
    b.silueta = !!c.silueta;
    guardarFotosLocal();
  }
  const bod = $('bodega');
  const wpx = b.a * ESCALA, hpx = b.f * ESCALA;
  const x = Math.max(0, Math.min(px, bod.clientWidth - wpx));
  const y = Math.max(0, Math.min(py, bod.clientHeight - hpx));
  const libre = buscarLibre({ dataset: { categoria: b.cat } }, wpx, hpx, x, y);
  if (!libre) { error('No hay espacio libre en ese punto'); return false; }
  b.x = libre.x;
  b.y = libre.y;
  if (b.cat === 'muro') {
    const edM = estado.bloques.find(e => e.cat === 'edificacion' && dentroDe(b, e));
    if (edM) ajustarMuroAEdificacion(b, edM);
  }
  estado.bloques.push(b);
  render(); guardarHistorial();
  marcarPosicion(b); seleccionar(b.id);
  c.restantes--;
  if (c.restantes <= 0) {
    const foto = c.foto;
    cancelarColocacion();
    $('nombreBloque').value = '';
    if (foto) $('fotoBloque').value = '';
  } else {
    aviso('Faltan ' + c.restantes + ' · clic para el siguiente');
  }
  return true;
}

// alta directa (sin modo colocación) — usada en las pruebas
function agregarBloqueAuto() {
  const b = leerFormulario();
  if (!b) return false;
  const cant = Math.max(1, Math.min(50, parseInt($('cantBloque').value, 10) || 1));
  const destino = $('destino').value;
  let n = 0;
  for (let i = 0; i < cant; i++) {
    const copia = JSON.parse(JSON.stringify(b));
    copia.id = nuevoId('b');
    if (destino && b.cat !== 'libre') {
      if (!meterEnStand(destino, copia)) break;
      n++;
      continue;
    }
    copia.cod = siguienteCodigo(copia.cat);
    if (!ubicar(copia)) break;
    n++;
  }
  if (n) { render(); guardarHistorial(); $('nombreBloque').value = ''; }
  return n > 0;
}

// coloca uno o varios bloques dentro de una edificación
function colocarDentroDe(ed, b, cant, fotoUrl, silueta) {
  let fid = null;
  if (fotoUrl) {
    fid = 'f' + (++fotoSeq);
    fotos[fid] = fotoUrl;
  }
  let n = 0, ultimo = null;
  for (let i = 0; i < cant; i++) {
    const copia = JSON.parse(JSON.stringify(b));
    copia.id = nuevoId('b');
    copia.cod = siguienteCodigo(copia.cat);
    copia.silueta = !!silueta;
    if (fid) copia.foto = fid;
    if (!ubicarDentro(ed, copia)) break;
    if (copia.cat === 'muro') ajustarMuroAEdificacion(copia, ed);
    estado.bloques.push(copia);
    ultimo = copia;
    n++;
  }
  if (!n) {
    const rs = recintosDe(ed).slice().sort((a2, b2) => b2.m2 - a2.m2);
    const disp = rs.length && rs[0]
      ? (rs[0].w / ESCALA).toFixed(2) + ' × ' + (rs[0].h / ESCALA).toFixed(2) + ' m'
      : (ed.a.toFixed(2) + ' × ' + ed.f.toFixed(2) + ' m');
    error('No cabe «' + b.nombre + '» (' + b.a.toFixed(2) + ' × ' + b.f.toFixed(2) +
      ' m) dentro de ' + ed.nombre + '. El espacio más amplio mide ' + disp +
      '. Ajusta las medidas o parte el área con ↔ / ↕.');
    return false;
  }
  if (fid) guardarFotosLocal();
  render(); guardarHistorial();
  if (ultimo) seleccionar(ultimo.id);
  ok(n + ' elemento(s) dentro de ' + ed.nombre);
  $('nombreBloque').value = '';
  return true;
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

function borrarBloque(id, silencioso) {
  const b = estado.bloques.find(x => x.id === id);
  if (!b) return;
  let ids = [id];
  if (b.cat === 'edificacion') {
    const kids = hijosContenidos(b);
    if (kids.length && !silencioso && !MODO_TEST &&
        !confirm('Esta edificación tiene ' + kids.length +
                 ' elemento(s) dentro (muros, equipos, puertas).\n¿Borrarla con todo y contenido?')) return;
    ids = ids.concat(kids.map(k => k.id));
  }
  if (selId && ids.indexOf(selId) >= 0) { selId = null; const sb = $('selBox'); if (sb) sb.style.display = 'none'; }
  estado.bloques = estado.bloques.filter(x => ids.indexOf(x.id) < 0);
  estado.aberturas = estado.aberturas.filter(a => ids.indexOf(a.dueno) < 0);
  render(); guardarHistorial();
}

function rotarBloque(id) {
  const b = estado.bloques.find(x => x.id === id); if (!b) return;
  const a = b.a, f = b.f;
  const wpx = f * ESCALA, hpx = a * ESCALA;
  const dom = document.getElementById('bodega');
  const wDom = dom.querySelector('.bloque-wrapper[data-id="' + b.id + '"]');
  const el = wDom || { dataset: { categoria: b.cat } };
  const choca = colisiona(el, b.x, b.y, wpx, hpx);
  const seSale = b.x + wpx > dom.clientWidth + 0.5 || b.y + hpx > dom.clientHeight + 0.5;
  // gira siempre; solo se acomoda para que no quede fuera del lienzo
  b.a = f; b.f = a; b.rot = !b.rot;
  b.x = Math.max(0, Math.min(b.x, Math.max(0, dom.clientWidth - b.a * ESCALA)));
  b.y = Math.max(0, Math.min(b.y, Math.max(0, dom.clientHeight - b.f * ESCALA)));
  render(); guardarHistorial();
  if (choca || seSale) aviso('Girado 90°. Quedó encimado o al borde: revisa que quepa.');
  else ok('Girado 90°');
}

/* ============================================================
   RENDER
   ============================================================ */
function render() {
  const bod = $('bodega');
  if (!bod) return;
  imagenCache = null;
  bod.querySelectorAll('.bloque-wrapper').forEach(e => e.remove());
  estado.bloques.forEach(b => bod.appendChild(crearElBloque(b)));
  // si un equipo tiene marco, su rótulo interno no se muestra (lo muestra el marco)
  estado.bloques.filter(b => b.cat === 'marca' && b.para).forEach(m => {
    const w = bod.querySelector('.bloque-wrapper[data-id="' + m.para + '"]');
    if (w) w.classList.add('con-marco');
  });
  if (selId) {
    const sel = bod.querySelector('.bloque-wrapper[data-id="' + selId + '"]');
    if (sel) sel.classList.add('sel');
  }
  actualizarTotales();
  dibujarRecintos();
  const tabActiva = document.querySelector('.tab.activa');
  if (tabActiva && tabActiva.dataset.tab === 'edif') pintarRecintos();
  programarVivo3D();
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
  if (b.a * ESCALA < 42 || b.f * ESCALA < 30) w.classList.add('mini');
  w.style.left = b.x + 'px';
  w.style.top = b.y + 'px';
  w.style.zIndex = b.cat === 'libre' ? 0 : (++zTop);
  w.style.setProperty('--fm', Math.max(3, Math.round((b.marca || 0) / 100 * ESCALA)) + 'px');
  w.addEventListener('pointerdown', e => iniciarArrastreBloque(e, b.id));

  if (b.cat === 'marca') { armarMarco(w, b); return w; }

  const bl = document.createElement('div');
  bl.className = 'bloque';
  bl.style.backgroundColor = b.color;

  const del = document.createElement('button');
  del.className = 'btn-del'; del.type = 'button'; del.textContent = '×'; del.title = 'Eliminar';
  del.addEventListener('pointerdown', e => e.stopPropagation());
  del.addEventListener('click', e => { e.stopPropagation(); borrarBloque(b.id); });
  w.appendChild(del);

  const rot = document.createElement('button');
  rot.className = 'btn-rot'; rot.type = 'button'; rot.textContent = '↻'; rot.title = 'Girar 90°';
  rot.addEventListener('pointerdown', e => e.stopPropagation());
  rot.addEventListener('click', e => { e.stopPropagation(); rotarBloque(b.id); });
  w.appendChild(rot);

  if (b.foto && fotos[b.foto]) {
    const fd = document.createElement('div');
    fd.className = 'bloque-foto';
    fd.style.backgroundImage = 'url("' + fotos[b.foto] + '")';
    bl.appendChild(fd);
  }

  const cont = document.createElement('div');
  cont.className = 'bloque-content';
  const wpx = b.a * ESCALA, hpx = b.f * ESCALA;
  const s1 = document.createElement('span');
  s1.textContent = (b.cod ? b.cod + ' ' : '') + b.nombre;
  const br = document.createElement('br');
  const s2 = document.createElement('span');
  s2.className = 'area-txt';
  s2.textContent = (b.a * b.f).toFixed(2) + ' m²';
  cont.append(s1, br, s2);
  // el texto se ajusta al tamaño real del bloque
  const largoNom = Math.max(4, ((b.cod ? b.cod.length + 1 : 0) + b.nombre.length));
  const conArea = (wpx >= 58 && hpx >= 34);
  let fs = Math.min(10, (wpx - 8) / (largoNom * 0.62), hpx * (conArea ? 0.26 : 0.42));
  fs = Math.max(5.5, fs);
  cont.style.fontSize = fs.toFixed(1) + 'px';
  // en bloques pequeños se recorta el nombre y se quita el área
  s1.style.display = 'block';
  s1.style.whiteSpace = 'nowrap';
  s1.style.overflow = 'hidden';
  s1.style.textOverflow = 'ellipsis';
  if (!conArea) s2.style.display = 'none';
  if (hpx < 16 || wpx < 22) { s1.textContent = b.cod || ''; }
  w.title = (b.cod ? b.cod + ' · ' : '') + b.nombre + '  (' + b.a.toFixed(2) + ' × ' +
            b.f.toFixed(2) + ' m · ' + (b.a * b.f).toFixed(2) + ' m²)';

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

  if (b.marca) ponerFranja(w, b);
  return w;
}

const LADOS_MARCA = {
  perimetro: ['arriba', 'abajo', 'izq', 'der'],
  u: ['izq', 'abajo', 'der'],
  l: ['izq', 'abajo'],
  frente: ['abajo'],
  lados: ['izq', 'der']
};

function anchoMarcaActual() {
  const mod = $('marcaAncho');
  const form = $('anchoMarca');
  return num(mod ? mod.value : (form ? form.value : 20), 20);
}

function ponerFranja(w, b) {
  const m = Math.max(2, Math.round((b.marca || 0) / 100 * ESCALA));
  const forma = b.marcaForma || 'perimetro';
  const color = b.marcaColor || 'amarillo-negro';
  (LADOS_MARCA[forma] || LADOS_MARCA.perimetro).forEach(k => {
    const d = document.createElement('div');
    d.className = 'franja f-' + k + ' ' + color;
    d.style.setProperty('--fm', m + 'px');
    w.appendChild(d);
  });
}

/* ============================================================
   MARCOS DE MARCADO (estirables con el ratón)
   ============================================================ */
const COLOR_MARCA = {
  'amarillo-negro': '#f1c40f', 'rojo-blanco': '#c0392b',
  'amarillo': '#f1c40f', 'gris': '#7f8c8d', 'blanco': '#ffffff', 'verde': '#27ae60'
};

function textoMarco(b) {
  const f = Math.max(0.05, num(b.franja, 0.15));
  return b.a.toFixed(2) + ' × ' + b.f.toFixed(2) + ' m · franja ' + Math.round(f * 100) + ' cm';
}

function armarMarco(w, b) {
  w.classList.add('marca-wrapper');
  const m = document.createElement('div');
  m.className = 'marco';
  ['arriba', 'abajo', 'izq', 'der'].forEach(k => {
    const f = document.createElement('div');
    f.className = 'marco-franja mf-' + k + ' ' + (b.marcaColor || 'amarillo-negro');
    f.style.setProperty('--fm', Math.max(2, num(b.franja, 0.15) * ESCALA) + 'px');
    m.appendChild(f);
  });
  const lbl = document.createElement('div');
  lbl.className = 'marco-lbl';
  const sp = document.createElement('span');
  sp.textContent = textoMarco(b);
  lbl.appendChild(sp);
  m.appendChild(lbl);
  w.appendChild(m);
  ['n', 's', 'e', 'w', 'ne', 'nw', 'se', 'sw'].forEach(d => {
    const h = document.createElement('div');
    h.className = 'mh mh-' + d;
    h.dataset.dir = d;
    h.title = 'Estirar';
    h.addEventListener('pointerdown', e => iniciarRedimensionMarco(e, b.id, d));
    w.appendChild(h);
  });
  w.title = b.nombre + ' · ' + textoMarco(b);
}

function iniciarRedimensionMarco(e, id, dir) {
  if (e.button !== undefined && e.button !== 0) return;
  e.preventDefault();
  e.stopPropagation();
  const b = estado.bloques.find(x => x.id === id);
  if (!b) return;
  const w = e.currentTarget.closest('.bloque-wrapper');
  const bod = $('bodega');
  const r = bod.getBoundingClientRect();
  const sx = (e.clientX - r.left) / zoomActual, sy = (e.clientY - r.top) / zoomActual;
  const b0 = { x: b.x, y: b.y, a: b.a, f: b.f };
  const W = bod.clientWidth, H = bod.clientHeight;
  const snap = v => Math.round(v / 0.05) * 0.05;
  let cambiado = false;

  const mover = ev => {
    const dx = (ev.clientX - r.left) / zoomActual - sx;
    const dy = (ev.clientY - r.top) / zoomActual - sy;
    let x = b0.x, y = b0.y, a = b0.a, f = b0.f;
    const right = b0.x + b0.a * ESCALA, bottom = b0.y + b0.f * ESCALA;
    if (dir.indexOf('e') >= 0) a = snap((right - b0.x + dx) / ESCALA);
    if (dir.indexOf('w') >= 0) {
      const nx = Math.max(0, Math.min(b0.x + dx, right - 6));
      a = snap((right - nx) / ESCALA); x = right - a * ESCALA;
    }
    if (dir.indexOf('s') >= 0) f = snap((bottom - b0.y + dy) / ESCALA);
    if (dir.indexOf('n') >= 0) {
      const ny = Math.max(0, Math.min(b0.y + dy, bottom - 6));
      f = snap((bottom - ny) / ESCALA); y = bottom - f * ESCALA;
    }
    a = Math.max(0.3, Math.min(a, W / ESCALA));
    f = Math.max(0.3, Math.min(f, H / ESCALA));
    x = Math.max(0, Math.min(x, W - a * ESCALA));
    y = Math.max(0, Math.min(y, H - f * ESCALA));
    b.x = x; b.y = y; b.a = a; b.f = f;
    w.style.width = (a * ESCALA) + 'px';
    w.style.height = (f * ESCALA) + 'px';
    w.style.left = x + 'px';
    w.style.top = y + 'px';
    const lbl = w.querySelector('.marco-lbl span');
    if (lbl) lbl.textContent = textoMarco(b);
    cambiado = true;
  };
  const fin = () => {
    w.removeEventListener('pointermove', mover);
    w.removeEventListener('pointerup', fin);
    w.removeEventListener('pointercancel', fin);
    if (cambiado) { render(); guardarHistorial(); seleccionar(b.id); }
  };
  w.setPointerCapture && w.setPointerCapture(e.pointerId);
  w.addEventListener('pointermove', mover);
  w.addEventListener('pointerup', fin);
  w.addEventListener('pointercancel', fin);
}

function crearMarco() {
  const base = estado.bloques.find(x => x.id === selId);
  if (!base) { aviso('Selecciona primero el equipo o la edificación a demarcar'); return false; }
  if (base.cat === 'marca') { aviso('Ese elemento ya es un marco: estíralo con los tiradores'); return false; }
  if (base.cat === 'libre') { aviso('Las zonas libres no se demarcan'); return false; }
  let franja = Math.max(0.05, num($('marcoFranja') ? $('marcoFranja').value : 0.15, 0.15));
  const margen = franja + 0.10;
  const color = $('marcaColor') ? $('marcaColor').value : 'amarillo-negro';
  const nb = {
    id: nuevoId('b'), cod: siguienteCodigo('marca'), cat: 'marca',
    nombre: 'Marco ' + (base.nombre || 'equipo'),
    a: +(base.a + 2 * margen).toFixed(2), f: +(base.f + 2 * margen).toFixed(2),
    h: 0.01, color: COLOR_MARCA[color] || '#f1c40f', marcaColor: color, franja: franja,
    marca: null, stand: null, estante: null, foto: null, silueta: false, rot: false, peso: 0,
    para: base.id, x: 0, y: 0
  };
  const bod = $('bodega');
  nb.x = Math.max(0, Math.min(base.x - margen * ESCALA, bod.clientWidth - nb.a * ESCALA));
  nb.y = Math.max(0, Math.min(base.y - margen * ESCALA, bod.clientHeight - nb.f * ESCALA));
  base.marca = null;                    // el marco reemplaza la franja pegada
  estado.bloques.push(nb);
  render(); guardarHistorial(); seleccionar(nb.id);
  ok('Marco creado · estíralo con los tiradores');
  return true;
}

function aplicarMedidasMarco() {
  const b = estado.bloques.find(x => x.id === selId);
  if (!b || b.cat !== 'marca') { aviso('Selecciona un marco en el plano'); return false; }
  const bod = $('bodega');
  const a = Math.max(0.3, num($('marcoAncho').value, b.a));
  const f = Math.max(0.3, num($('marcoFondo').value, b.f));
  const fr = Math.max(0.05, Math.min(Math.min(a, f) / 2 - 0.01, num($('marcoFranja').value, b.franja)));
  const cx = b.x + b.a * ESCALA / 2, cy = b.y + b.f * ESCALA / 2;
  b.a = a; b.f = f; b.franja = fr;
  b.x = Math.max(0, Math.min(cx - a * ESCALA / 2, bod.clientWidth - a * ESCALA));
  b.y = Math.max(0, Math.min(cy - f * ESCALA / 2, bod.clientHeight - f * ESCALA));
  render(); guardarHistorial(); seleccionar(b.id);
  ok('Medidas del marco actualizadas');
  return true;
}


let arrastre = null;

function iniciarArrastreBloque(e, id) {
  if (e.button !== undefined && e.button !== 0) return;
  if (e.target.closest('.btn-del, .btn-rot, .ab-ov, .mh')) return;
  e.preventDefault();
  const b = estado.bloques.find(x => x.id === id); if (!b) return;
  const w = e.currentTarget;
  const bod = $('bodega');
  const r = bod.getBoundingClientRect();
  const x0 = b.x, y0 = b.y;
  const hijos = b.cat === 'edificacion' ? hijosContenidos(b) : [];
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
    if (!movido) { w.style.left = x0 + 'px'; w.style.top = y0 + 'px'; seleccionar(id); return; }
    const libre = buscarLibre(w, wpx, hpx, nx, ny);
    const destino = libre || { x: nx, y: ny };
    const dx = destino.x - x0, dy = destino.y - y0;
    b.x = destino.x; b.y = destino.y;
    if (b.cat === 'muro') {
      const edM = estado.bloques.find(x => x.cat === 'edificacion' && dentroDe(b, x));
      if (edM) ajustarMuroAEdificacion(b, edM);
    }
    if (hijos.length && (dx || dy)) {
      b.x = x0; b.y = y0;
      moverConContenido(b, dx, dy);
      render();
    } else {
      w.style.left = b.x + 'px'; w.style.top = b.y + 'px';
    }
    if (!libre) error('No había espacio libre: quedó encimado. Puedes activar «Mover libre».');
    marcarPosicion(b);
    guardarHistorial();
    refrescarPaneles();
  };
  w.addEventListener('pointermove', mover);
  w.addEventListener('pointerup', fin);
  w.addEventListener('pointercancel', fin);
}

/* ============================================================
   COLISIONES
   ============================================================ */
function colisiona(el, x, y, w, h) {
  const cat = (el && el.dataset && el.dataset.categoria) || '';
  if ($('libreSolape') && $('libreSolape').checked) return false;
  // pasillos, muros y marcos se pueden ubicar encima de todo
  if (cat === 'libre' || cat === 'muro' || cat === 'marca') return false;
  const otros = $('bodega').querySelectorAll('.bloque-wrapper');
  for (const o of otros) {
    if (o === el) continue;
    const oc = o.dataset.categoria;
    if (oc === 'libre' || oc === 'muro' || oc === 'marca') continue;
    // un equipo puede quedar DENTRO de una edificación (y viceversa)
    if ((cat === 'objeto' && oc === 'edificacion') ||
        (cat === 'edificacion' && oc === 'objeto')) continue;
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

  const paso = Math.max(SNAP, 5);
  const xs = [], ys = [];
  for (let x = 0; x <= maxX; x += paso) xs.push(x);
  for (let y = 0; y <= maxY; y += paso) ys.push(y);
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
  return estado.bloques.reduce((t, b) => t + ((b.cat === 'libre' || b.cat === 'marca') ? 0 : b.a * b.f), 0);
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
  refrescarEdificaciones();
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
  estado.bloques.filter(b => b.cat === 'edificacion' || b.cat === 'muro').forEach(b => {
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
  const cabLey = el('p', nombreProyecto + '  ·  ' +
    new Date().toLocaleDateString('es-CO', { day: '2-digit', month: '2-digit', year: 'numeric' }));
  cabLey.className = 'cab-leyenda';
  cont.appendChild(cabLey);
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
   ['muro', 'MUROS DIVISORIOS'],
   ['marca', 'MARCOS DE MARCADO'],
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
      fila(tr, w.a.toFixed(2) + ' × ' + w.f.toFixed(2) +
        (clave === 'libre' || clave === 'marca' ? '' : ' × ' + w.h.toFixed(2)) +
        (clave === 'marca' ? ' · franja ' + Math.round(num(w.franja, 0.15) * 100) + ' cm' : ''), 'num');
      fila(tr, clave === 'marca' ? '—' : m2(area), 'num');
      t.appendChild(tr);
      if (clave !== 'marca') sub += area;
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

  const edsLey = estado.bloques.filter(b => b.cat === 'edificacion');
  if (edsLey.some(ed => recintosDe(ed).length > 1)) {
    cont.appendChild(el('h4', 'RECINTOS POR EDIFICACIÓN'));
    const tr2 = el('table'), th3 = el('tr');
    ['Edificación / tramo', 'Nombre', 'Medidas (m)', 'Área'].forEach((x, i) =>
      th3.appendChild(el('th', x, i > 1 ? 'num' : '')));
    tr2.appendChild(th3);
    edsLey.forEach(ed => {
      const rs = recintosDe(ed);
      if (rs.length < 2) return;
      let sub = 0;
      rs.forEach(r => {
        const tr = el('tr');
        fila(tr, ed.nombre + ' · T' + r.tramo);
        fila(tr, nombreRecinto(r));
        fila(tr, (r.w / ESCALA).toFixed(2) + ' × ' + (r.h / ESCALA).toFixed(2), 'num');
        fila(tr, m2(r.m2), 'num');
        sub += r.m2;
        tr2.appendChild(tr);
      });
      const ts = el('tr', undefined, 'sub');
      fila(ts, '');
      fila(ts, 'Subtotal ' + ed.nombre);
      fila(ts, '');
      fila(ts, m2(sub), 'num');
      tr2.appendChild(ts);
    });
    cont.appendChild(tr2);
  }

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

function orientarSprites() {
  sprites.forEach(sp => {
    sp.style.transform = 'translate3d(' + sp.dataset.x + 'px,' + sp.dataset.y + 'px,' + sp.dataset.z +
      'px) translateX(-50%) rotateY(' + (-cam.ry) + 'deg)';
  });
}

function aplicarCamara() {
  cam.rx = Math.max(-90, Math.min(-5, cam.rx));
  cam.z = Math.max(0.2, Math.min(6, cam.z));
  $('escena3d').style.transform =
    'scale(' + cam.z + ') rotateX(' + cam.rx + 'deg) rotateY(' + cam.ry + 'deg) translate3d(' +
    (-mundoW / 2) + 'px, 0px, ' + (-mundoF / 2) + 'px)';
  orientarSprites();
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

  const verTechos = $('verTechos') && $('verTechos').checked;
  const tipoCubierta = $('cubierta') ? $('cubierta').value : 'plana';
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
    const flip = (clave === 'abajo' || clave === 'izq');
    const huecos = huecosDe('bodega', clave, hP, flip, largo);
    mundo.appendChild(caraMuro(w, hP, tr, e, colP, huecos,
      abHTML('bodega', clave, largo, hP, flip)));
  };
  pared(mundoW, 'translate3d(0px, ' + (-hP) + 'px, 0px)', 'arriba', 1);
  pared(mundoW, 'translate3d(0px, ' + (-hP) + 'px, ' + mundoF + 'px) rotateY(180deg)', 'abajo', 0.95);
  pared(mundoF, 'translate3d(' + (-mundoF / 2) + 'px, ' + (-hP) + 'px, ' + (mundoF / 2) + 'px) rotateY(90deg)', 'izq', 0.85);
  pared(mundoF, 'translate3d(' + (mundoW - mundoF / 2) + 'px, ' + (-hP) + 'px, ' + (mundoF / 2) + 'px) rotateY(-90deg)', 'der', 0.9);

  if (verTechos && tipoCubierta !== 'ninguna') {
    const col = 'rgba(126,138,150,.88)';
    const est = { backgroundColor: col, outline: '1px solid rgba(0,0,0,.28)' };
    if (tipoCubierta === 'plana') {
      mundo.appendChild(cara(mundoW, mundoF,
        'translate3d(0px,' + (-hP) + 'px,0px) rotateX(90deg)',
        Object.assign({ transformOrigin: '0 0' }, est)));
    } else {
      const hC = Math.max(hP + 10, (num($('alturaCumbrera').value, 6)) * ESCALA);
      const rise = hC - hP, half = mundoW / 2;
      const ang = Math.atan2(rise, half) * 180 / Math.PI;
      const len = Math.sqrt(half * half + rise * rise);
      mundo.appendChild(cara(len, mundoF,
        'translate3d(0px,' + (-hP) + 'px,0px) rotateZ(' + (-ang) + 'deg) rotateX(90deg)',
        Object.assign({ transformOrigin: '0 0' }, est)));
      mundo.appendChild(cara(len, mundoF,
        'translate3d(' + mundoW + 'px,' + (-hP) + 'px,0px) scaleX(-1) rotateZ(' +
        (-ang) + 'deg) rotateX(90deg)',
        Object.assign({ transformOrigin: '0 0' }, est)));
    }
  }

  estado.bloques.forEach(b => {
    const l = b.x, t = b.y, w = b.a * ESCALA, d = b.f * ESCALA;
    const esMarca = b.cat === 'libre';
    const h = (esMarca ? 0.05 : b.h) * ESCALA;
    const medidas = num(b.a, 1).toFixed(2) + ' × ' + num(b.f, 1).toFixed(2) + (esMarca ? '' : ' × ' + num(b.h, 2.6).toFixed(2)) + ' m';
    const base = { backgroundColor: b.color };
    if (b.foto && fotos[b.foto] && b.silueta) {
      const sp = cara(w, h, '', {
        backgroundImage: 'url("' + fotos[b.foto] + '")',
        backgroundSize: 'contain', backgroundPosition: 'center bottom',
        backgroundRepeat: 'no-repeat', outline: 'none'
      });
      sp.className = 'cara3d sprite3d';
      sp.dataset.x = (l + w / 2);
      sp.dataset.y = -h;
      sp.dataset.z = (t + d / 2);
      sprites.push(sp);
      mundo.appendChild(sp);
      return;                       // con silueta no dibujamos el cubo
    }
    const ajusteFoto = ($('ajusteFoto') && $('ajusteFoto').value) || 'cover';
    const lado = br => {
      const e = Object.assign({}, base, { filter: 'brightness(' + br + ')' });
      if (b.foto && fotos[b.foto]) {
        e.backgroundImage = 'url("' + fotos[b.foto] + '")';
        e.backgroundSize = ajusteFoto;
        e.backgroundPosition = 'center';
        e.backgroundRepeat = 'no-repeat';
      }
      return e;
    };
    mundo.appendChild(cara(w + 14, d + 14, 'translate3d(' + (l - 7) + 'px, -0.5px, ' + (t - 7) + 'px) rotateX(90deg)', {
      transformOrigin: '0 0', background: 'rgba(0,0,0,.38)', filter: 'blur(5px)', outline: 'none', borderRadius: '6px'
    }));
    // huella en el piso: deja ver exactamente dónde está apoyado el bloque
    if (!esMarca) {
      mundo.appendChild(cara(w, d, 'translate3d(' + l + 'px, -0.8px, ' + t + 'px) rotateX(90deg)', {
        transformOrigin: '0 0', background: 'transparent', outline: '1.5px solid rgba(0,0,0,.55)'
      }));
    }
    if (b.estante) { dibujarEstante(mundo, b, l, t, w, d, h); return; }
    // solo rotulamos la cara superior si el equipo es grande (si no, se solapan los textos)
    const etiqueta = (b.a * b.f >= 1.4)
      ? '<span>' + escapar(b.nombre) + '<br>' + medidas + '</span>' : '';
    const cerrado = (b.cat === 'objeto' || b.cat === 'libre') || verTechos;
    if (cerrado) {
      mundo.appendChild(cara(w, d, 'translate3d(' + l + 'px, ' + (-h) + 'px, ' + t + 'px) rotateX(90deg)',
        Object.assign({}, base, { transformOrigin: '0 0' }), etiqueta));
    }
    // edificaciones sin techo: paredes completas translúcidas para ver el interior
    const esEdif = b.cat === 'edificacion';
    const translucido = esEdif && !verTechos;
    if (esEdif) {
      mundo.appendChild(cara(w, d, 'translate3d(' + l + 'px, -1px, ' + t + 'px) rotateX(90deg)', {
        transformOrigin: '0 0', background: 'rgba(52,152,219,.14)', outline: 'none'
      }));
    }
    const hW = h;
    const estiloEdif = br => {
      const e = lado(br);
      if (translucido) e.opacity = 0.32;
      return e;
    };
    mundo.appendChild(caraMuro(w, hW, 'translate3d(' + l + 'px, ' + (-hW) + 'px, ' + (t + d) + 'px)',
      estiloEdif(1), b.color, huecosDe(b.id, 'abajo', h, false, b.a), abHTML(b.id, 'abajo', b.a, h, false)));
    mundo.appendChild(caraMuro(w, hW, 'translate3d(' + l + 'px, ' + (-hW) + 'px, ' + t + 'px) rotateY(180deg)',
      estiloEdif(0.7), b.color, huecosDe(b.id, 'arriba', h, true, b.a), abHTML(b.id, 'arriba', b.a, h, true)));
    mundo.appendChild(caraMuro(d, hW, 'translate3d(' + (l - d / 2) + 'px, ' + (-hW) + 'px, ' + (t + d / 2) + 'px) rotateY(-90deg)',
      estiloEdif(0.85), b.color, huecosDe(b.id, 'izq', h, false, b.f), abHTML(b.id, 'izq', b.f, h, false)));
    mundo.appendChild(caraMuro(d, hW, 'translate3d(' + (l + w - d / 2) + 'px, ' + (-hW) + 'px, ' + (t + d / 2) + 'px) rotateY(90deg)',
      estiloEdif(0.65), b.color, huecosDe(b.id, 'der', h, true, b.f), abHTML(b.id, 'der', b.f, h, true)));

    // puertas y ventanas visibles (hoja/marco en 3D)
    if (translucido) {
      estado.aberturas.filter(a => a.dueno === b.id).forEach(a => {
        const anchoPx = Math.max(4, num(a.ancho, 1) * ESCALA);
        const altoPx = Math.max(4, num(a.alto, 2) * ESCALA);
        const y0 = Math.max(0, num(a.desde, 0) * ESCALA);
        const pos = Math.max(0, num(a.pos, 0) * ESCALA);
        const col = a.tipo === 'puerta' ? 'rgba(139,69,19,.72)'
          : a.tipo === 'ventana' ? 'rgba(93,173,226,.58)' : 'rgba(44,62,80,.42)';
        if (a.pared === 'abajo') caja3D(mundo, l + pos, t + d - 1.5, anchoPx, 3, y0, altoPx, col);
        else if (a.pared === 'arriba') caja3D(mundo, l + pos, t - 1.5, anchoPx, 3, y0, altoPx, col);
        else if (a.pared === 'izq') caja3D(mundo, l - 1.5, t + pos, 3, anchoPx, y0, altoPx, col);
        else caja3D(mundo, l + w - 1.5, t + pos, 3, anchoPx, y0, altoPx, col);
      });
    }
  });

  const diag = Math.sqrt(mundoW * mundoW + mundoF * mundoF) || 1;
  cam = { rx: -55, ry: -25, z: Math.min(2, 0.8 * Math.min(window.innerWidth, window.innerHeight) / diag) };
  aplicarCamara();
  $('vista3d').classList.add('activa');
  $('btnCerrar3D').focus();
  setTimeout(() => {
    if (!imagenCache) imagen3D().then(c => { imagenCache = c; }).catch(() => { });
  }, 80);
}

function escapar(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function huecosDe(dueno, pared, altoPx, flip, largoM) {
  return estado.aberturas.filter(a => a.dueno === dueno && a.pared === pared).map(a => ({
    x: (flip ? largoM - a.pos - a.ancho : a.pos) * ESCALA,
    y: altoPx - (a.desde + a.alto) * ESCALA,
    wo: a.ancho * ESCALA,
    ho: a.alto * ESCALA,
    tipo: a.tipo
  }));
}

// Trocea la pared en piezas alrededor de los huecos (agujero real)
function piezasMuro(w, h, huecos, color) {
  if (!huecos.length) return null;
  const hs = huecos.slice().sort((a, b) => a.x - b.x);
  const out = [];
  const add = (x, y, ww, hh) => {
    if (ww > 0.6 && hh > 0.6) {
      out.push('<div style="position:absolute;left:' + x.toFixed(1) + 'px;top:' + y.toFixed(1) +
        'px;width:' + ww.toFixed(1) + 'px;height:' + hh.toFixed(1) + 'px;background:' + color + '"></div>');
    }
  };
  let x0 = 0;
  hs.forEach(o => {
    if (o.x > x0) add(x0, 0, o.x - x0, h);
    if (o.y > 0) add(o.x, 0, o.wo, o.y);
    if (o.y + o.ho < h) add(o.x, o.y + o.ho, o.wo, h - (o.y + o.ho));
    x0 = Math.max(x0, o.x + o.wo);
  });
  if (x0 < w) add(x0, 0, w - x0, h);
  return out.join('');
}

function caraMuro(w, h, tr, estilo, color, huecos, htmlAb) {
  if (huecos && huecos.length && !estilo.backgroundImage) {
    const html = piezasMuro(w, h, huecos, color);
    if (html) {
      const e = Object.assign({}, estilo);
      delete e.backgroundColor;
      return cara(w, h, tr, e, html);
    }
  }
  return cara(w, h, tr, estilo, htmlAb);
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
/* ---------- extras del taller (techo, paredes, cubierta) ---------- */
let modoEtiquetas = 'todas';

function aplicarEtiquetas(modo, guardar) {
    const validos = ['todas', 'areas', 'ninguna'];
    modoEtiquetas = validos.indexOf(modo) >= 0 ? modo : 'todas';
    document.body.classList.remove('etiquetas-todas', 'etiquetas-areas', 'etiquetas-ninguna', 'sin-nombres');
    document.body.classList.add('etiquetas-' + modoEtiquetas);
    if (modoEtiquetas === 'ninguna') document.body.classList.add('sin-nombres');
    const btn = $('btnEtiquetas');
    if (btn) {
        btn.textContent = modoEtiquetas === 'todas' ? '🏷️ Todas'
            : modoEtiquetas === 'areas' ? '🏷️ Áreas' : '🏷️ Limpio';
        btn.classList.toggle('areas', modoEtiquetas === 'areas');
        btn.classList.toggle('limpio', modoEtiquetas === 'ninguna');
        btn.title = modoEtiquetas === 'todas'
            ? 'Etiquetas: nombres y áreas. Clic para ver solo áreas.'
            : modoEtiquetas === 'areas'
                ? 'Etiquetas: solo áreas. Clic para dejar el plano limpio.'
                : 'Plano limpio sin etiquetas. Clic para mostrar todo.';
    }
    if ($('verNombres')) $('verNombres').checked = modoEtiquetas === 'todas';
    if (guardar) {
        try { localStorage.setItem('ctc_etiquetas', modoEtiquetas); } catch (_) { }
    }
}

function sincronizarExtras() {
    const ap = $('altoPared'), cu = $('cubierta'), ac = $('alturaCumbrera'), cp = $('colorPared');
    if (ap) estado.altoPared = Math.max(1, num(ap.value, 4));
    if (cu) estado.cubierta = cu.value;
    if (ac) estado.alturaCumbrera = Math.max(1, num(ac.value, 6));
    if (cp) estado.colorPared = cp.value;
    if ($('imgParedesCompletas')) estado.imgParedesCompletas = $('imgParedesCompletas').checked;
    estado.nombreProyecto = nombreProyecto;
}

function aplicarExtras() {
    if ($('altoPared')) $('altoPared').value = num(estado.altoPared, 4);
    if ($('cubierta')) $('cubierta').value = estado.cubierta || 'plana';
    if ($('alturaCumbrera')) $('alturaCumbrera').value = num(estado.alturaCumbrera, 6);
    if ($('colorPared')) $('colorPared').value = estado.colorPared || '#e6e2da';
    if ($('nombreProyecto')) $('nombreProyecto').value = nombreProyecto;
    if ($('imgParedesCompletas')) $('imgParedesCompletas').checked = !!estado.imgParedesCompletas;
    if ($('verTechos')) $('verTechos').checked = false;
}

function refrescarFotosPared() {
    ['arriba', 'abajo', 'izq', 'der'].forEach(k => marcarFotoPared(k, !!fotosPared[k]));
}

/* ---------- recintos: formato nuevo (anclas) y viejo (mapa) ---------- */
function normalizarRecintos(r) {
    const limpio = n => String(n || '').trim().slice(0, 60);
    if (Array.isArray(r)) {
        return r.map(x => ({
            ed: x && x.ed ? String(x.ed) : '',
            nombre: limpio(x && x.nombre),
            cx: num(x && x.cx, 0), cy: num(x && x.cy, 0),
            idx: x && isFinite(x.idx) ? Number(x.idx) : null,
            legacy: !!(x && x.legacy)
        })).filter(x => x.nombre);
    }
    if (r && typeof r === 'object') {
        return Object.keys(r).map(k => {
            const i = k.indexOf('#');
            return {
                ed: i > 0 ? k.slice(0, i) : '',
                nombre: limpio(r[k]),
                cx: 0, cy: 0,
                idx: parseInt(k.slice(i + 1), 10) || 0,
                legacy: true
            };
        }).filter(x => x.nombre);
    }
    return [];
}

/* ---------- normalizar bloques importados ---------- */
function normalizarBloques(arr) {
    return (Array.isArray(arr) ? arr : []).filter(b => b && b.id).map(b => {
        const cat = ['objeto', 'edificacion', 'muro', 'libre', 'marca'].indexOf(b.cat) >= 0 ? b.cat : 'objeto';
        const def = TAM_DEFECTO[cat] || [1, 1, 1];
        b.cat = cat;
        b.a = Math.max(0.05, num(b.a, def[0]));
        b.f = Math.max(0.05, num(b.f, def[1]));
        b.h = Math.max(0.05, num(b.h, cat === 'marca' ? 0.01 : def[2]));
        b.x = Math.max(0, num(b.x, 0));
        b.y = Math.max(0, num(b.y, 0));
        b.nombre = String(b.nombre || 'Elemento').slice(0, 60);
        b.color = b.color || COLORES[cat];
        if (cat === 'marca') b.franja = Math.max(0.05, num(b.franja, 0.15));
        return b;
    });
}

/* ---------- documento del proyecto ---------- */
function documentoProyecto() {
    sincronizarExtras();
    return {
        app: 'ctc-planta', version: 2, fecha: new Date().toISOString(),
        nombre: nombreProyecto,
        ancho: estado.ancho, fondo: estado.fondo,
        extras: {
            altoPared: estado.altoPared, cubierta: estado.cubierta,
            alturaCumbrera: estado.alturaCumbrera, colorPared: estado.colorPared,
            imgParedesCompletas: !!estado.imgParedesCompletas
        },
        bloques: estado.bloques, aberturas: estado.aberturas,
        recintos: estado.recintos,
        fotos: fotos, fotosPared: fotosPared,
        biblioteca: { extra: bibExtra, ocultos: bibOcultos }
    };
}

function recalcularIdSeq() {
    let max = idSeq;
    const ver = id => {
        const m = String(id || '').match(/(\d+)$/);
        if (m) max = Math.max(max, parseInt(m[1], 10) || 0);
    };
    (estado.bloques || []).forEach(b => ver(b.id));
    (estado.aberturas || []).forEach(a => ver(a.id));
    Object.keys(fotos).forEach(ver);
    idSeq = max;
    fotoSeq = Math.max(fotoSeq, max);
}

/* ---------- IndexedDB (guardado grande, con fotos) ---------- */
let dbPromesa = null;
function abrirDB() {
    if (dbPromesa) return dbPromesa;
    dbPromesa = new Promise((res, rej) => {
        if (typeof indexedDB === 'undefined') return rej(new Error('sin indexedDB'));
        const r = indexedDB.open('ctc_planta_v2', 1);
        r.onupgradeneeded = () => {
            const db = r.result;
            if (!db.objectStoreNames.contains('proyecto')) db.createObjectStore('proyecto');
            if (!db.objectStoreNames.contains('biblioteca')) db.createObjectStore('biblioteca');
        };
        r.onsuccess = () => res(r.result);
        r.onerror = () => rej(r.error);
    });
    return dbPromesa;
}

function idbPut(store, clave, valor) {
    return abrirDB().then(db => new Promise((res, rej) => {
        const tx = db.transaction(store, 'readwrite');
        tx.objectStore(store).put(valor, clave);
        tx.oncomplete = () => res(true);
        tx.onerror = () => rej(tx.error);
        tx.onabort = () => rej(tx.error || new Error('abort'));
    }));
}

function idbGet(store, clave) {
    return abrirDB().then(db => new Promise((res, rej) => {
        const tx = db.transaction(store, 'readonly');
        const req = tx.objectStore(store).get(clave);
        req.onsuccess = () => res(req.result || null);
        req.onerror = () => rej(req.error);
    }));
}

function idbDel(store, clave) {
    return abrirDB().then(db => new Promise((res, rej) => {
        const tx = db.transaction(store, 'readwrite');
        tx.objectStore(store).delete(clave);
        tx.oncomplete = () => res(true);
        tx.onerror = () => rej(tx.error);
    }));
}

/* ---------- ayuda rápida ---------- */
function abrirAyuda() {
    const m = $('ayudaModal');
    if (m) m.classList.add('activa');
}
function cerrarAyuda() {
    const m = $('ayudaModal');
    if (m) m.classList.remove('activa');
}


function guardarLocal() {
    if (MODO_TEST) return;
    try {
        localStorage.setItem(LS_KEY, JSON.stringify({
            version: 2, ancho: estado.ancho, fondo: estado.fondo,
            bloques: estado.bloques, aberturas: estado.aberturas,
            recintos: estado.recintos, extras: documentoProyecto().extras,
            nombre: nombreProyecto
        }));
    } catch (_) { }
    programarGuardado();
}

/* ---------- guardado automático ---------- */
let guardadoTimer = null, guardando = false, ultimoGuardado = null;
let autosaveBloqueado = false, sucio = false;

function marcarGuardado(txt, clase) {
    const el = $('guardadoInfo');
    if (el) { el.textContent = txt; el.className = 'guardado' + (clase ? ' ' + clase : ''); }
}

function programarGuardado() {
    if (MODO_TEST || autosaveBloqueado) return;
    sucio = true;
    marcarGuardado('Cambios sin guardar…', 'pendiente');
    clearTimeout(guardadoTimer);
    guardadoTimer = setTimeout(() => guardarProyecto(false), 900);
}

async function guardarProyecto(manual) {
    if (MODO_TEST) return false;
    if (guardando) {
        clearTimeout(guardadoTimer);
        guardadoTimer = setTimeout(() => guardarProyecto(manual), 500);
        return false;
    }
    guardando = true;
    try {
        sincronizarExtras();
        const doc = documentoProyecto();
        await idbPut('proyecto', 'actual', doc);
        try { localStorage.setItem(LS_PROY, JSON.stringify({ nombre: doc.nombre, fecha: doc.fecha })); } catch (_) { }
        ultimoGuardado = new Date();
        marcarGuardado('Guardado ' + ultimoGuardado.toLocaleTimeString('es-CO', { hour: '2-digit', minute: '2-digit' }), 'ok');
        if (manual) ok('Proyecto guardado en este dispositivo');
        return true;
    } catch (e) {
        // respaldo sin fotos, por si el navegador no deja IndexedDB
        try {
            localStorage.setItem(LS_KEY, JSON.stringify({
                version: 2, ancho: estado.ancho, fondo: estado.fondo,
                bloques: estado.bloques, aberturas: estado.aberturas,
                recintos: estado.recintos, extras: documentoProyecto().extras, nombre: nombreProyecto
            }));
        } catch (_) { }
        marcarGuardado('Guardado básico (sin fotos). Usa Archivo .json', 'error');
        if (manual) error('No se pudo guardar completo. Descarga el archivo .json por seguridad.');
        return false;
    } finally {
        guardando = false;
    }
}

/* ---------- cargar proyecto ---------- */
async function cargarProyectoInicial() {
    const pedido = (async () => {
        try { return await idbGet('proyecto', 'actual'); } catch (_) { return null; }
    })();
    let doc = null;
    let lento = false;
    const r = await Promise.race([
        pedido,
        new Promise(res => setTimeout(() => res('__lento__'), 2500))
    ]);
    if (r === '__lento__') {
        lento = true;
        autosaveBloqueado = true;
        // si la base responde después, y el usuario no ha tocado nada, se aplica
        pedido.then(d => {
            autosaveBloqueado = false;
            if (d && !sucio && !estado.bloques.length) aplicarProyecto(d);
        }).catch(() => { autosaveBloqueado = false; });
    } else {
        doc = r;
    }
    if (!doc) {
        try {
            const raw = localStorage.getItem(LS_KEY);
            if (raw) doc = JSON.parse(raw);
        } catch (_) { }
    }
    if (doc && num(doc.ancho, 0) > 0) { aplicarProyecto(doc); return true; }
    if (lento) setTimeout(() => { autosaveBloqueado = false; }, 6000);
    return false;
}

function aplicarProyecto(d) {
    const ex = d.extras || {};
    estado = {
        version: 2,
        ancho: Math.max(1, num(d.ancho, 10.13)),
        fondo: Math.max(1, num(d.fondo, 20.45)),
        bloques: normalizarBloques(d.bloques),
        aberturas: Array.isArray(d.aberturas) ? d.aberturas : [],
        recintos: normalizarRecintos(d.recintos),
        altoPared: Math.max(1, num(ex.altoPared || d.altoPared, 4)),
        cubierta: ex.cubierta || d.cubierta || 'plana',
        alturaCumbrera: Math.max(1, num(ex.alturaCumbrera || d.alturaCumbrera, 6)),
        colorPared: ex.colorPared || d.colorPared || '#e6e2da',
        imgParedesCompletas: !!ex.imgParedesCompletas
    };
    Object.keys(fotos).forEach(k => delete fotos[k]);
    if (d.fotos && typeof d.fotos === 'object') Object.assign(fotos, d.fotos);
    Object.keys(fotosPared).forEach(k => delete fotosPared[k]);
    if (d.fotosPared && typeof d.fotosPared === 'object') Object.assign(fotosPared, d.fotosPared);
    if (d.biblioteca) {
        if (Array.isArray(d.biblioteca.extra)) bibExtra = d.biblioteca.extra;
        if (Array.isArray(d.biblioteca.ocultos)) bibOcultos = d.biblioteca.ocultos;
        pintarBiblioteca();
    }
    nombreProyecto = (d.nombre || 'Taller CTC Energy').slice(0, 60);
    aplicarExtras();
    recalcularIdSeq();
    aplicarEstado();
    refrescarFotosPared();
    marcarGuardado('Proyecto cargado', 'ok');
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
    aplicarExtras();
    render();
    listarAb();
    prepararImpresion();
}

/* ---------- archivo del proyecto ---------- */
function slug(txt) {
    return String(txt || 'planta').normalize('NFD').replace(/[\u0300-\u036f]/g, '')
        .replace(/[^a-zA-Z0-9]+/g, '-').replace(/^-+|-+$/g, '').toLowerCase().slice(0, 40) || 'planta';
}
function fechaArchivo() {
    const d = new Date();
    const p = n => String(n).padStart(2, '0');
    return d.getFullYear() + p(d.getMonth() + 1) + p(d.getDate()) + '-' + p(d.getHours()) + p(d.getMinutes());
}

function descargarBlob(blob, nombre) {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = nombre;
    document.body.appendChild(a);
    a.click();
    setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 3000);
}

function exportarJSON() {
    const doc = documentoProyecto();
    const blob = new Blob([JSON.stringify(doc, null, 2)], { type: 'application/json' });
    descargarBlob(blob, 'proyecto-' + slug(nombreProyecto) + '-' + fechaArchivo() + '.json');
    ok('Archivo del proyecto descargado');
}

async function compartirProyecto() {
    sincronizarExtras();
    const doc = documentoProyecto();
    const blob = new Blob([JSON.stringify(doc)], { type: 'application/json' });
    const nombre = 'proyecto-' + slug(nombreProyecto) + '-' + fechaArchivo() + '.json';
    try {
        const file = new File([blob], nombre, { type: 'application/json' });
        if (navigator.canShare && navigator.canShare({ files: [file] })) {
            await navigator.share({
                files: [file], title: nombreProyecto,
                text: 'Proyecto del simulador de planta · ' + nombreProyecto
            });
            return;
        }
    } catch (e) {
        if (e && e.name === 'AbortError') return;
    }
    descargarBlob(blob, nombre);
    setTimeout(() => window.open('https://wa.me/?text=' + encodeURIComponent(
        nombreProyecto + ' · te envío el archivo del proyecto (adjúntalo en WhatsApp)'), '_blank'), 700);
    aviso('Archivo guardado: adjúntalo en WhatsApp', 'ok');
}

function nuevoProyecto() {
    if (!confirm('¿Empezar un proyecto nuevo? Se borra el plano actual (el guardado anterior se reemplaza).')) return;
    estado = {
        version: 2, ancho: 10.13, fondo: 20.45, bloques: [], aberturas: [],
        recintos: [], altoPared: 4, cubierta: 'plana', alturaCumbrera: 6, colorPared: '#e6e2da',
        imgParedesCompletas: false
    };
    Object.keys(fotos).forEach(k => delete fotos[k]);
    limpiarFotosPared();
    nombreProyecto = 'Taller CTC Energy';
    if ($('nombreProyecto')) $('nombreProyecto').value = nombreProyecto;
    aplicarExtras();
    aplicarEstado();
    guardarHistorial();
    ok('Proyecto nuevo');
}

function aplicarImportacion(d, modo) {
    if (!d || !num(d.ancho, 0) || !Array.isArray(d.bloques)) throw new Error('formato');
    if (modo === 'agregar') {
        if (d.fotos) Object.assign(fotos, d.fotos);
        if (d.biblioteca && Array.isArray(d.biblioteca.extra)) {
            d.biblioteca.extra.forEach(x => { if (!bibExtra.some(y => y.id === x.id)) bibExtra.push(x); });
            guardarBibLocal(); pintarBiblioteca();
        }
        let n = 0;
        d.bloques.forEach(b => {
            const c = normalizarBloques([JSON.parse(JSON.stringify(b))])[0];
            if (!c) return;
            c.id = nuevoId('b');
            c.cod = siguienteCodigo(c.cat);
            const px = num(c.x, 0), py = num(c.y, 0);
            if (ubicarEn(c, px, py)) n++;
        });
        if (n) { render(); guardarFotosLocal(); guardarHistorial(); }
        ok(n + ' elemento(s) agregado(s) al plano');
        return n;
    }
    if (estado.bloques.length && !MODO_TEST &&
        !confirm('Se va a reemplazar el proyecto actual por el del archivo. ¿Continuar?')) return 0;
    aplicarProyecto(d);
    historial = []; histIdx = -1;
    guardarHistorial();
    ok('Proyecto abierto');
    return (d.bloques || []).length;
}

function importarJSON(file, modo) {
    const r = new FileReader();
    r.onload = () => {
        try {
            aplicarImportacion(JSON.parse(r.result), modo || 'reemplazar');
        } catch (e) {
            error('El archivo no es un proyecto válido');
        }
    };
    r.readAsText(file);
}

/* ---------- compartir la vista 3D (PNG) ---------- */
function instantanea() {
    sincronizarExtras();
    return {
        nombreProyecto: nombreProyecto, ancho: estado.ancho, fondo: estado.fondo,
        altoPared: estado.altoPared, cubierta: estado.cubierta,
        alturaCumbrera: estado.alturaCumbrera, colorPared: estado.colorPared,
        bloques: estado.bloques, fotos: fotos, aberturas: estado.aberturas
    };
}

async function imagen3D(opts) {
    if (!window.CTC3D) { error('No está disponible el generador de imagen'); return null; }
    try {
        return await window.CTC3D.render(instantanea(), opts || {});
    } catch (e) {
        error('No se pudo dibujar la vista 3D');
        return null;
    }
}

async function compartir3D(soloDescargar) {
    const completas = $('imgParedesCompletas') ? $('imgParedesCompletas').checked : false;
    const cv = await imagen3D({ paredesCompletas: completas });
    if (!cv) return;
    const blob = await window.CTC3D.aBlob(cv);
    if (!blob) { error('No se pudo crear el PNG'); return; }
    const nombre = 'planta-3d-' + slug(nombreProyecto) + '-' + fechaArchivo() + '.png';
    const texto = 'Planta 3D · ' + nombreProyecto + ' · ' +
        estado.ancho.toFixed(2) + ' × ' + estado.fondo.toFixed(2) + ' m';
    if (!soloDescargar && typeof File !== 'undefined' && navigator.canShare) {
        try {
            const file = new File([blob], nombre, { type: 'image/png' });
            if (navigator.canShare({ files: [file] })) {
                await navigator.share({ files: [file], title: nombreProyecto, text: texto });
                return;
            }
        } catch (e) {
            if (e && e.name === 'AbortError') return;
        }
    }
    descargarBlob(blob, nombre);
    if (soloDescargar) { ok('Imagen 3D descargada'); return; }
    setTimeout(() => window.open('https://wa.me/?text=' + encodeURIComponent(
        texto + ' — te adjunto la imagen que acabo de guardar'), '_blank'), 800);
    aviso('Imagen guardada. Adjúntala en WhatsApp', 'ok');
}

/* ============================================================
   VISTA 3D EN VIVO (mientras se edita)
   ============================================================ */
function ubicarVivo3D(pos) {
    const p = $('vivo3d');
    if (!p || !/^(tl|tr|bl|br)$/.test(String(pos))) return;
    p.classList.remove('pos-tl', 'pos-tr', 'pos-bl', 'pos-br');
    p.classList.add('pos-' + pos);
}

function cerrarPanelSiMovil() {
    if (window.innerWidth > 820) return;
    const p = $('panel');
    if (p) p.classList.remove('abierto');
    const b = $('panelBackdrop');
    if (b) b.classList.remove('activa');
    const btn = $('btn-panel');
    if (btn) btn.setAttribute('aria-expanded', 'false');
}

function alternarVivo3D(forzar, recordar) {
    const panel = $('vivo3d');
    if (!panel) return;
    vivo3dAbierto = typeof forzar === 'boolean' ? forzar : !vivo3dAbierto;
    if (recordar !== false && !MODO_TEST) {
        try { localStorage.setItem('ctc_vivo3d', vivo3dAbierto ? '1' : '0'); } catch (_) { }
    }
    panel.classList.toggle('activa', vivo3dAbierto);
    const btn = $('btnVivo3D');
    if (btn) {
        btn.classList.toggle('activo', vivo3dAbierto);
        btn.setAttribute('aria-pressed', vivo3dAbierto ? 'true' : 'false');
    }
    if (vivo3dAbierto) actualizarVivo3D();
}

function programarVivo3D() {
    if (!vivo3dAbierto) return;
    clearTimeout(vivoTimer);
    vivoTimer = setTimeout(() => actualizarVivo3D(), 180);
}

async function actualizarVivo3D() {
    if (!vivo3dAbierto || !window.CTC3D) return;
    const token = ++vivoToken;
    let cv = null;
    try {
        cv = await window.CTC3D.render(instantanea(), { giro: vivoGiro, zoom: vivoZoom, compacto: true });
    } catch (_) { return; }
    if (!cv || token !== vivoToken || !vivo3dAbierto) return;
    const host = $('vivoLienzo');
    if (!host) return;
    host.innerHTML = '';
    cv.className = 'vivo-canvas';
    host.appendChild(cv);
    const eq = estado.bloques.filter(b => b.cat === 'objeto').length;
    const mu = estado.bloques.filter(b => b.cat === 'muro').length;
    const ed = estado.bloques.filter(b => b.cat === 'edificacion').length;
    const info = $('vivoInfo');
    const plural = (n, s, p) => n + ' ' + (n === 1 ? s : p);
    if (info) info.textContent = plural(eq, 'equipo', 'equipos') + ' · ' +
        plural(mu, 'muro', 'muros') + ' · ' + plural(ed, 'edificación', 'edificaciones');
}


// coloca un bloque en una posición (o en el hueco libre más cercano)
function ubicarEn(b, px, py) {
  const bod = $('bodega');
  const wpx = b.a * ESCALA, hpx = b.f * ESCALA;
  if (b.cat !== 'libre' && areaOcupada() + b.a * b.f > estado.ancho * estado.fondo + 1e-9) return false;
  const x = Math.max(0, Math.min(px, bod.clientWidth - wpx));
  const y = Math.max(0, Math.min(py, bod.clientHeight - hpx));
  const libre = buscarLibre({ dataset: { categoria: b.cat } }, wpx, hpx, x, y);
  if (!libre) return false;
  b.x = libre.x;
  b.y = libre.y;
  estado.bloques.push(b);
  return true;
}

/* ============================================================
   MÓDULOS (pestañas)
   ============================================================ */
/* ============================================================
   RECINTOS: partición por muros (horizontal + vertical)
   ============================================================ */
function limitar(v, a, b) { return Math.max(a, Math.min(b, v)); }

function dentroDe(bl, ed) {
    const cx = bl.x + bl.a * ESCALA / 2, cy = bl.y + bl.f * ESCALA / 2;
    return cx > ed.x + 1 && cx < ed.x + ed.a * ESCALA - 1 &&
        cy > ed.y + 1 && cy < ed.y + ed.f * ESCALA - 1;
}

function hijosContenidos(ed) {
    return estado.bloques.filter(b => b !== ed && b.cat !== 'libre' && b.cat !== 'marca' &&
        b.cat !== 'edificacion' && dentroDe(b, ed));
}

function moverConContenido(ed, dx, dy) {
    const kids = hijosContenidos(ed);
    ed.x += dx; ed.y += dy;
    kids.forEach(h => { h.x += dx; h.y += dy; });
    return kids.length;
}

function murosDe(ed) {
    return estado.bloques.filter(m => m.cat === 'muro' && dentroDe(m, ed));
}

function recintosDe(ed) {
    const W = ed.a * ESCALA, H = ed.f * ESCALA;
    const muros = murosDe(ed).map(m => ({
        x0: Math.max(0, m.x - ed.x), y0: Math.max(0, m.y - ed.y),
        x1: Math.min(W, m.x - ed.x + m.a * ESCALA), y1: Math.min(H, m.y - ed.y + m.f * ESCALA)
    })).filter(r => r.x1 - r.x0 > 1 && r.y1 - r.y0 > 1);

    const xs = [0, W], ys = [0, H];
    muros.forEach(r => { xs.push(r.x0, r.x1); ys.push(r.y0, r.y1); });
    const uniq = v => {
        v.sort((a, b) => a - b);
        const out = [];
        v.forEach(x => { if (!out.length || Math.abs(x - out[out.length - 1]) > 0.01) out.push(x); });
        return out;
    };
    const X = uniq(xs.filter(x => x >= -0.01 && x <= W + 0.01).map(x => limitar(x, 0, W)));
    const Y = uniq(ys.filter(y => y >= -0.01 && y <= H + 0.01).map(y => limitar(y, 0, H)));
    const nx = X.length - 1, ny = Y.length - 1;
    if (nx <= 0 || ny <= 0) return [];

    const bloqueada = [], vistos = [];
    for (let j = 0; j < ny; j++) {
        bloqueada[j] = []; vistos[j] = [];
        for (let i = 0; i < nx; i++) {
            const cx0 = X[i], cx1 = X[i + 1], cy0 = Y[j], cy1 = Y[j + 1];
            bloqueada[j][i] = muros.some(r =>
                r.x0 < cx1 - 0.01 && r.x1 > cx0 + 0.01 && r.y0 < cy1 - 0.01 && r.y1 > cy0 + 0.01);
            vistos[j][i] = false;
        }
    }

    const salas = [];
    for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
        if (bloqueada[j][i] || vistos[j][i]) continue;
        const cola = [[i, j]]; vistos[j][i] = true;
        const celdas = [];
        while (cola.length) {
            const [ci, cj] = cola.pop();
            celdas.push([ci, cj]);
            [[1, 0], [-1, 0], [0, 1], [0, -1]].forEach(([di, dj]) => {
                const ni = ci + di, nj = cj + dj;
                if (ni >= 0 && ni < nx && nj >= 0 && nj < ny && !vistos[nj][ni] && !bloqueada[nj][ni]) {
                    vistos[nj][ni] = true; cola.push([ni, nj]);
                }
            });
        }
        if (!celdas.length) continue;
        let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity, area = 0, mx = 0, my = 0;
        celdas.forEach(([ci, cj]) => {
            const a = (X[ci + 1] - X[ci]) * (Y[cj + 1] - Y[cj]);
            area += a;
            mx += a * (X[ci] + X[ci + 1]) / 2;
            my += a * (Y[cj] + Y[cj + 1]) / 2;
            x0 = Math.min(x0, X[ci]); x1 = Math.max(x1, X[ci + 1]);
            y0 = Math.min(y0, Y[cj]); y1 = Math.max(y1, Y[cj + 1]);
        });
        const m2s = area / (ESCALA * ESCALA);
        if (m2s < 0.04 || !area) continue;
        salas.push({
            x: ed.x + x0, y: ed.y + y0, w: x1 - x0, h: y1 - y0,
            area: area, m2: m2s,
            cx: ed.x + mx / area, cy: ed.y + my / area,
            ed: ed.id
        });
    }

    salas.sort((a, b) => (a.y - b.y) || (a.x - b.x));
    salas.forEach((r, i) => { r.tramo = i + 1; r.key = ed.id + '#' + i; });
    if (!salas.length) {
        return [{
            x: ed.x, y: ed.y, w: W, h: H, area: W * H, m2: ed.a * ed.f,
            cx: ed.x + W / 2, cy: ed.y + H / 2, ed: ed.id, tramo: 1, key: ed.id + '#0'
        }];
    }
    return salas;
}

function anclaRecinto(r) {
    let mejor = null, dMin = Infinity;
    (estado.recintos || []).forEach(a => {
        if (a.ed !== r.ed || !a.nombre) return;
        if (!a.cx && !a.cy) return;              // ancla vieja sin posición
        const d = Math.hypot(a.cx - r.cx, a.cy - r.cy);
        if (d < dMin && d < 1.1 * ESCALA) { dMin = d; mejor = a; }
    });
    return mejor;
}

function nombreRecinto(r) {
    const a = anclaRecinto(r);
    if (a && a.nombre) return a.nombre;
    const leg = (estado.recintos || []).find(x =>
        x.legacy && x.ed === r.ed && Number(x.idx) + 1 === r.tramo);
    return (leg && leg.nombre) || ('Tramo ' + r.tramo);
}

function renombrarRecinto(r, nombre) {
    const txt = String(nombre || '').trim().slice(0, 60);
    let a = anclaRecinto(r);
    if (!a) {
        a = { ed: r.ed, cx: r.cx, cy: r.cy, nombre: '' };
        estado.recintos.push(a);
    }
    a.nombre = txt; a.cx = r.cx; a.cy = r.cy;
    delete a.legacy;
    estado.recintos = estado.recintos.filter(x => x.nombre || x === a);
    dibujarRecintos();
    guardarLocal();
}

function dibujarRecintos() {
    const bod = $('bodega');
    if (!bod) return;
    bod.querySelectorAll('.recinto-lbl').forEach(e => e.remove());
    bod.querySelectorAll('.bloque-wrapper.con-recintos').forEach(e => e.classList.remove('con-recintos'));
    estado.bloques.filter(b => b.cat === 'edificacion').forEach(ed => {
        const rs = recintosDe(ed);
        const w = bod.querySelector('.bloque-wrapper[data-id="' + ed.id + '"]');
        if (w) w.classList.toggle('con-recintos', rs.length > 1);
        if (rs.length < 2) return;
        rs.forEach(r => {
            const d = document.createElement('div');
            d.className = 'recinto-lbl';
            const nombre = nombreRecinto(r);
            const sn = document.createElement('span');
            sn.className = 'recinto-nombre';
            sn.textContent = nombre;
            const sa = document.createElement('span');
            sa.className = 'recinto-area';
            sa.textContent = r.m2.toFixed(2) + ' m²';
            d.append(sn, sa);
            const left = limitar(r.cx, r.x + 3, r.x + r.w - 3);
            const top = limitar(r.cy, r.y + 3, r.y + r.h - 3);
            d.style.left = left + 'px';
            d.style.top = top + 'px';
            d.style.maxWidth = Math.max(26, r.w - 6) + 'px';
            d.style.fontSize = Math.max(5.4, Math.min(8, r.h / 7)) + 'px';
            d.title = nombre + '\n' + (r.w / ESCALA).toFixed(2) + ' × ' +
                (r.h / ESCALA).toFixed(2) + ' m · ' + r.m2.toFixed(2) + ' m²';
            bod.appendChild(d);
        });
    });
}

function pintarRecintos() {
    const c = $('listaRecintos');
    if (!c) return;
    c.innerHTML = '';
    const eds = estado.bloques.filter(b => b.cat === 'edificacion');
    if (!eds.length) {
        c.innerHTML = '<p class="ayuda">Todavía no hay edificaciones. Crea una con el formulario de arriba.</p>';
        return;
    }
    eds.forEach(ed => {
        const rs = recintosDe(ed);
        const cab = document.createElement('div');
        cab.className = 'edif-cab';
        cab.textContent = (ed.cod ? ed.cod + ' · ' : '') + ed.nombre + ' — ' +
            (ed.a * ed.f).toFixed(2) + ' m²';
        c.appendChild(cab);
        rs.forEach(r => {
            const fila = document.createElement('div');
            fila.className = 'recinto-fila';
            const cab2 = document.createElement('div');
            cab2.className = 'cab';
            const izq = document.createElement('span');
            izq.textContent = 'Tramo ' + r.tramo + ' · ' +
                (r.w / ESCALA).toFixed(2) + ' × ' + (r.h / ESCALA).toFixed(2) + ' m';
            const der = document.createElement('b');
            der.textContent = r.m2.toFixed(2) + ' m²';
            cab2.append(izq, der);
            const inp = document.createElement('input');
            inp.type = 'text';
            inp.maxLength = 60;
            inp.placeholder = 'Nombre del área (ej. Oficina, Baño)';
            const actual = nombreRecinto(r);
            inp.value = /^Tramo \d+$/.test(actual) ? '' : actual;
            inp.addEventListener('change', () => {
                renombrarRecinto(r, inp.value);
                programarGuardado();
                if (document.querySelector('.tab.activa').dataset.tab === 'edif') pintarRecintos();
            });
            fila.append(cab2, inp);
            c.appendChild(fila);
        });
    });
}

/* ============================================================
   EDIFICACIONES: lista, destino y colocación dentro
   ============================================================ */
function dentroSeleccionado() {
    const sel = $('dentroDe');
    if (!sel || !sel.value) return null;
    return estado.bloques.find(b => b.id === sel.value && b.cat === 'edificacion') || null;
}

function verEnPlano(id) {
    const w = document.querySelector('.bloque-wrapper[data-id="' + id + '"]');
    if (w && w.scrollIntoView) w.scrollIntoView({ block: 'center', inline: 'center', behavior: 'smooth' });
}

function buscarLibreDentro(ed, wpx, hpx, cat) {
    if (wpx > ed.a * ESCALA + 0.5 || hpx > ed.f * ESCALA + 0.5) return null;
    const maxX = ed.x + ed.a * ESCALA - wpx, maxY = ed.y + ed.f * ESCALA - hpx;
    if (maxX < ed.x - 0.5 || maxY < ed.y - 0.5) return null;
    const el = { dataset: { categoria: cat || 'objeto' } };
    const paso = Math.max(2, SNAP);
    const centroX = ed.x + (ed.a * ESCALA - wpx) / 2;
    const centroY = ed.y + (ed.f * ESCALA - hpx) / 2;
    const candidatos = [];
    for (let y = ed.y; y <= maxY + 0.01; y += paso) {
        for (let x = ed.x; x <= maxX + 0.01; x += paso) candidatos.push([x, y]);
    }
    if (!candidatos.length) candidatos.push([Math.max(ed.x, maxX), Math.max(ed.y, maxY)]);
    candidatos.sort((a, b) =>
        (Math.hypot(a[0] - centroX, a[1] - centroY) - Math.hypot(b[0] - centroX, b[1] - centroY)));
    for (let i = 0; i < candidatos.length; i++) {
        const [x, y] = candidatos[i];
        if (cat !== 'muro' && chocaMuroEn(ed, x, y, wpx, hpx)) continue;
        if (!colisiona(el, x, y, wpx, hpx)) return { x: Math.round(x), y: Math.round(y) };
    }
    return null;
}

function chocaMuroEn(ed, x, y, w, h) {
    return murosDe(ed).some(m => {
        const mx = m.x, my = m.y, mw = m.a * ESCALA, mh = m.f * ESCALA;
        return x < mx + mw - 0.01 && x + w > mx + 0.01 && y < my + mh - 0.01 && y + h > my + 0.01;
    });
}

function ubicarDentro(ed, b) {
    const libre = buscarLibreDentro(ed, b.a * ESCALA, b.f * ESCALA, b.cat);
    if (!libre) return false;
    b.x = libre.x; b.y = libre.y;
    return true;
}

function refrescarEdificaciones() {
    const eds = estado.bloques.filter(b => b.cat === 'edificacion');
    const sel = $('dentroDe');
    if (sel) {
        const prev = sel.value;
        sel.innerHTML = '';
        const o = document.createElement('option');
        o.value = ''; o.textContent = '— En el plano general —';
        sel.appendChild(o);
        eds.forEach(ed => {
            const op = document.createElement('option');
            op.value = ed.id;
            op.textContent = (ed.cod ? ed.cod + ' · ' : '') + ed.nombre;
            sel.appendChild(op);
        });
        sel.value = eds.some(e => e.id === prev) ? prev : '';
    }
    const c = $('listaEdif');
    if (!c) return;
    c.innerHTML = '';
    if (!eds.length) {
        c.innerHTML = '<p class="ayuda">Aún no hay edificaciones. Crea la primera con el formulario de arriba.</p>';
        return;
    }
    eds.forEach(ed => {
        const kids = hijosContenidos(ed);
        const muros = kids.filter(k => k.cat === 'muro').length;
        const eqs = kids.filter(k => k.cat === 'objeto').length;
        const fila = document.createElement('div');
        fila.className = 'edif-fila';
        const t = document.createElement('div');
        t.className = 'edif-txt';
        t.innerHTML = '<b>' + escapar((ed.cod ? ed.cod + ' · ' : '') + ed.nombre) + '</b>' +
            '<small>' + ed.a.toFixed(2) + ' × ' + ed.f.toFixed(2) + ' m · ' +
            (ed.a * ed.f).toFixed(2) + ' m² · ' + muros + ' muro(s) · ' + eqs + ' equipo(s)</small>';
        const acc = document.createElement('div');
        acc.className = 'edif-acciones';
        const mini = (txt, title, fn) => {
            const b = document.createElement('button');
            b.type = 'button'; b.className = 'mini';
            b.textContent = txt; b.title = title || txt;
            b.addEventListener('click', fn);
            acc.appendChild(b);
        };
        mini('Ver', 'Ver en el plano', () => verEnPlano(ed.id));
        mini('Editar', 'Editar medidas', () => {
            seleccionar(ed.id);
            if ($('panel')) $('panel').scrollTo({ top: 0, behavior: 'smooth' });
        });
        mini('＋ Equipo', 'Agregar un equipo dentro de ' + ed.nombre, () => equipoDentroDe(ed));
        mini('↔', 'Partir el área en dos (horizontal)', () => dividirArea('h', ed));
        mini('↕', 'Partir el área en dos (vertical)', () => dividirArea('v', ed));
        fila.append(t, acc);
        c.appendChild(fila);
    });
}

function cerrarMuroSeleccionado() {
    const b = estado.bloques.find(x => x.id === selId);
    if (!b || b.cat !== 'muro') { aviso('Selecciona un muro divisorio'); return; }
    const ed = estado.bloques.find(e => e.cat === 'edificacion' && dentroDe(b, e));
    if (!ed) { aviso('Ese muro no está dentro de una edificación'); return; }
    const esV = b.f > b.a;
    if (!esV) { b.a = ed.a; b.x = ed.x; }
    else { b.f = ed.f; b.y = ed.y; }
    render(); guardarHistorial();
    seleccionar(b.id);
    if (document.querySelector('.tab.activa') &&
        document.querySelector('.tab.activa').dataset.tab === 'edif') pintarRecintos();
    ok('Muro extendido: el área quedó partida en dos');
}

function dividirArea(dir, ed) {
    const rs = recintosDe(ed).slice().sort((a, b) => b.m2 - a.m2);
    if (!rs.length) return false;
    const r = rs[0];
    const esV = dir === 'v';
    const esp = 0.15;
    const m = {
        id: nuevoId('b'), cod: siguienteCodigo('muro'), cat: 'muro',
        nombre: esV ? 'División vertical' : 'División horizontal',
        a: esV ? esp : r.w / ESCALA,
        f: esV ? r.h / ESCALA : esp,
        h: Math.min(2.4, Math.max(1, num(ed.h, 2.6) - 0.2)),
        color: '#5d6d7e', peso: 0, marca: null, stand: null, estante: null,
        foto: null, silueta: false, rot: false,
        x: esV ? r.x + r.w / 2 - (esp * ESCALA) / 2 : r.x,
        y: esV ? r.y : r.y + r.h / 2 - (esp * ESCALA) / 2
    };
    estado.bloques.push(m);
    render(); guardarHistorial();
    if ($('dentroDe')) $('dentroDe').value = ed.id;
    if ($('listaRecintos')) pintarRecintos();
    ok('Área partida en dos. Escribe el nombre de cada tramo.');
    return true;
}

function equipoDentroDe(ed) {
    if (!ed) return;
    if ($('dentroDe')) $('dentroDe').value = ed.id;
    cambiarTab('equipos');
    elegirTipo('objeto');
    if ($('dentroDe')) $('dentroDe').value = ed.id;
    const disp = medidasDisponibles(ed);
    const a = Math.max(0.3, Math.min(1.6, disp.a - 0.2));
    const f = Math.max(0.3, Math.min(1.0, disp.f - 0.2));
    const h = Math.max(0.5, Math.min(1.6, num(ed.h, 2.6) - 0.4));
    $('anchoBloque').value = a.toFixed(2);
    $('fondoBloque').value = f.toFixed(2);
    $('altoBloque').value = h.toFixed(2);
    $('nombreBloque').value = '';
    $('nombreBloque').focus();
    if ($('formElemento')) {
        try { $('formElemento').scrollIntoView({ block: 'center', behavior: 'smooth' }); } catch (_) { }
    }
    aviso('Equipo para ' + ed.nombre + ' · escribe nombre y medidas, luego «+ Ubicar»');
}

function medidasDisponibles(ed) {
    const rs = recintosDe(ed).slice().sort((a, b) => b.m2 - a.m2);
    if (!rs.length) return { a: ed.a, f: ed.f };
    return { a: rs[0].w / ESCALA, f: rs[0].h / ESCALA };
}

function ajustarMuroAEdificacion(m, ed) {
    if (!m || m.cat !== 'muro' || !ed) return;
    const esV = m.f > m.a;
    if (!esV) {
        if (m.a >= ed.a - 0.3) { m.a = ed.a; m.x = ed.x; }
        else if (Math.abs(m.x - ed.x) < 0.2) m.x = ed.x;
    } else {
        if (m.f >= ed.f - 0.3) { m.f = ed.f; m.y = ed.y; }
        else if (Math.abs(m.y - ed.y) < 0.2) m.y = ed.y;
    }
}

function refrescarPaneles() {
    refrescarEdificaciones();
    const activa = document.querySelector('.tab.activa');
    if (activa && activa.dataset.tab === 'edif') pintarRecintos();
}

function cambiarTab(nombre) {
  document.querySelectorAll('.marca').forEach(b =>
    b.classList.toggle('activa', b.dataset.tab === nombre));
  document.querySelectorAll('.tab').forEach(s =>
    s.classList.toggle('activa', s.dataset.tab === nombre));
  const ab = $('bloqueAb');
  if (ab) {
    $('hostAbBodega').appendChild(ab);
    ab.style.display = (nombre === 'taller') ? 'block' : 'none';
    if (nombre === 'edif') { $('hostAbEdif').appendChild(ab); ab.style.display = 'block'; }
  }
  if (nombre === 'edif') pintarRecintos();
  const f = $('formElemento');
  if (nombre === 'equipos') {
    $('hostEq').appendChild(f);
    f.style.display = 'block';
    elegirTipo('objeto');
  } else if (nombre === 'edif') {
    $('hostEdif').appendChild(f);
    f.style.display = 'block';
    elegirTipo('edificacion');
  } else {
    f.style.display = 'none';
  }
  if (nombre === 'marcacion') pintarVistaMarca();
  refrescarPaneles();
}

function datosMarca() {
  return {
    color: $('marcaColor') ? $('marcaColor').value : 'amarillo-negro',
    forma: $('marcaForma') ? $('marcaForma').value : 'perimetro',
    cm: num($('marcaAncho') ? $('marcaAncho').value : 20, 20)
  };
}

function pintarVistaMarca() {
  const v = $('vistaMarca');
  if (!v) return;
  const m = datosMarca();
  v.innerHTML = '';
  const caja = document.createElement('div');
  caja.style.cssText = 'position:absolute;left:50%;top:50%;transform:translate(-50%,-50%);' +
    'width:150px;height:36px;';
  const fm = Math.max(3, Math.round(m.cm / 100 * 20));
  (LADOS_MARCA[m.forma] || LADOS_MARCA.perimetro).forEach(k => {
    const d = document.createElement('div');
    d.className = 'franja f-' + k + ' ' + m.color;
    d.style.setProperty('--fm', (fm + 3) + 'px');
    caja.appendChild(d);
  });
  const dentro = document.createElement('div');
  dentro.style.cssText = 'position:absolute;inset:9px 13px;background:#F4D03F;' +
    'border:1px solid #6b6b6b;border-radius:2px;';
  caja.appendChild(dentro);
  v.appendChild(caja);
}

function aplicarMarca(soloSeleccionado) {
  const m = datosMarca();
  const poner = b => { b.marca = m.cm; b.marcaColor = m.color; b.marcaForma = m.forma; };
  if (soloSeleccionado) {
    const b = estado.bloques.find(x => x.id === selId);
    if (!b) { aviso('Primero selecciona un elemento en el plano'); return; }
    poner(b);
  } else {
    estado.bloques.filter(b => b.cat === 'objeto').forEach(poner);
  }
  render(); guardarHistorial();
  ok('Marcación aplicada');
}

/* ============================================================
   BIBLIOTECA DE EQUIPOS
   ============================================================ */
function cargarBibLocal() {
  try {
    const d = JSON.parse(localStorage.getItem(LS_BIB) || '{}');
    bibExtra = Array.isArray(d.extra) ? d.extra : [];
    bibOcultos = Array.isArray(d.ocultos) ? d.ocultos : [];
  } catch (_) { bibExtra = []; bibOcultos = []; }
}

async function cargarBiblioteca() {
  try {
    const d = await idbGet('biblioteca', 'actual');
    if (d) {
      if (Array.isArray(d.extra)) bibExtra = d.extra;
      if (Array.isArray(d.ocultos)) bibOcultos = d.ocultos;
      pintarBiblioteca();
      return;
    }
  } catch (_) { }
  cargarBibLocal();
}

function guardarBibLocal() {
  try { localStorage.setItem(LS_BIB, JSON.stringify({ extra: bibExtra, ocultos: bibOcultos })); }
  catch (_) { }
  if (!MODO_TEST) {
    idbPut('biblioteca', 'actual', { extra: bibExtra, ocultos: bibOcultos }).catch(() => { });
  }
}

function iconoEquipo() {
  return 'data:image/svg+xml;utf8,' + encodeURIComponent(
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 120 90">' +
    '<rect x="14" y="26" width="92" height="50" rx="6" fill="#cfd8dc" stroke="#607d8b" stroke-width="3"/>' +
    '<rect x="26" y="36" width="30" height="18" rx="3" fill="#90a4ae"/>' +
    '<circle cx="88" cy="45" r="9" fill="#78909c"/>' +
    '<rect x="26" y="60" width="68" height="8" rx="3" fill="#b0bec5"/></svg>');
}

function nombreDeArchivo(nombre) {
  return String(nombre || 'equipo').replace(/\.[^.]+$/, '').replace(/[_-]+/g, ' ')
    .replace(/\s+/g, ' ').trim().slice(0, 40) || 'Equipo';
}

function fotoDeArchivo(file, recorta) {
  return new Promise(res => {
    cargarFoto(file, url => {
      if (!url) return res(null);
      if (recorta) recortarFondo(url, out => res(out || url));
      else res(url);
    }, 750);
  });
}

function nuevaBibItem(nombre, a, f, h, foto) {
  return {
    id: 'u' + Date.now() + Math.random().toString(36).slice(2, 6),
    nombre: nombre, a: +a.toFixed(2), f: +f.toFixed(2), h: +h.toFixed(2),
    foto: foto || iconoEquipo(), silueta: !!foto
  };
}

async function agregarBibDesdeForm() {
  const nombre = ($('bibNombre').value || '').trim().slice(0, 40);
  const a = num($('bibAncho').value, 0), f = num($('bibFondo').value, 0), h = num($('bibAlto').value, 0);
  const input = $('bibFoto');
  const files = input && input.files ? Array.from(input.files) : [];
  const recorta = $('bibRecorte') ? $('bibRecorte').checked : true;
  const limpiar = () => {
    ['bibNombre', 'bibAncho', 'bibFondo', 'bibAlto'].forEach(id => { if ($(id)) $(id).value = ''; });
    if (input) input.value = '';
  };

  // varios archivos: un equipo por imagen (nombre = archivo, medidas = las del formulario o 1 m)
  if (files.length > 1) {
    const A = a > 0 ? a : 1, F = f > 0 ? f : 1, H = h > 0 ? h : 1;
    const nuevos = [];
    for (let i = 0; i < files.length; i++) {
      const foto = await fotoDeArchivo(files[i], recorta);
      const nombreItem = (nombre ? nombre + ' ' + (i + 1) : nombreDeArchivo(files[i].name));
      nuevos.push(nuevaBibItem(nombreItem, A, F, H, foto));
    }
    nuevos.forEach(x => bibExtra.push(x));
    guardarBibLocal(); pintarBiblioteca(); limpiar();
    ok(nuevos.length + ' equipos agregados a la biblioteca');
    return true;
  }

  if (!nombre) { error('Ponle nombre al equipo'); return false; }
  if (a <= 0 || f <= 0 || h <= 0) { error('Completa ancho, fondo y alto (en metros)'); return false; }
  let foto = null;
  if (files.length) foto = await fotoDeArchivo(files[0], recorta);
  bibExtra.push(nuevaBibItem(nombre, a, f, h, foto));
  guardarBibLocal(); pintarBiblioteca(); limpiar();
  ok(nombre + ' agregado a la biblioteca');
  return true;
}

function restaurarBiblioteca() {
  bibOcultos = [];
  guardarBibLocal();
  pintarBiblioteca();
  ok('Biblioteca restaurada');
}

function catalogo() {
  const base = (typeof BIBLIOTECA !== 'undefined' ? BIBLIOTECA : []);
  return base.filter(x => bibOcultos.indexOf(x.id) < 0).concat(bibExtra);
}

function pintarBiblioteca() {
  const c = $('bib');
  if (!c) return;
  c.innerHTML = '';
  catalogo().forEach(b => {
    const d = document.createElement('div');
    d.className = 'bib-item';
    d.draggable = true;
    d.title = b.nombre + '  ·  ' + b.a.toFixed(2) + ' × ' + b.f.toFixed(2) + ' × ' + b.h.toFixed(2) + ' m';
    const im = document.createElement('img');
    im.src = b.foto;
    im.alt = b.nombre;
    const sp = document.createElement('span');
    sp.textContent = b.nombre;
    const x = document.createElement('button');
    x.type = 'button';
    x.className = 'bib-del';
    x.textContent = '✕';
    x.title = 'Quitar de la biblioteca';
    x.addEventListener('click', e => { e.stopPropagation(); quitarDeBib(b.id); });
    d.append(im, sp, x);
    d.addEventListener('click', () => usarBib(b.id));
    d.addEventListener('dragstart', e => {
      e.dataTransfer.setData('text/plain', b.id);
      e.dataTransfer.effectAllowed = 'copy';
    });
    c.appendChild(d);
  });
}

function usarBib(id) {
  const b = catalogo().find(x => x.id === id);
  if (!b) return;
  elegirTipo('objeto');
  $('nombreBloque').value = b.nombre;
  $('anchoBloque').value = b.a;
  $('fondoBloque').value = b.f;
  $('altoBloque').value = b.h;
  fotoPendiente = b.foto;
  aviso(b.nombre + ' cargado · ajusta las medidas y pulsa "+ Ubicar en el plano"');
  $('nombreBloque').scrollIntoView({ block: 'center', behavior: 'smooth' });
}

function crearDesdeBib(id, clientX, clientY) {
  const b = catalogo().find(x => x.id === id);
  if (!b) return false;
  const bod = $('bodega'), r = bod.getBoundingClientRect();
  const px = (clientX - r.left) / zoomActual - (b.a * ESCALA) / 2;
  const py = (clientY - r.top) / zoomActual - (b.f * ESCALA) / 2;
  const nb = {
    id: nuevoId('b'), cod: siguienteCodigo('objeto'), cat: 'objeto', nombre: b.nombre,
    a: b.a, f: b.f, h: b.h, color: '#f1c40f', peso: 0,
    marca: anchoMarcaActual(), stand: null, estante: null,
    foto: null, silueta: b.silueta !== false, rot: false, x: 0, y: 0
  };
  if (!ubicarEn(nb, Math.round(px / SNAP) * SNAP, Math.round(py / SNAP) * SNAP)) return false;
  const fid = 'f' + (++fotoSeq);
  fotos[fid] = b.foto;
  nb.foto = fid;
  guardarFotosLocal();
  render(); guardarHistorial(); seleccionar(nb.id);
  ok(b.nombre + ' agregado');
  return true;
}

function quitarDeBib(id) {
  if (typeof BIBLIOTECA !== 'undefined' && BIBLIOTECA.some(b => b.id === id)) {
    if (bibOcultos.indexOf(id) < 0) bibOcultos.push(id);
  } else {
    bibExtra = bibExtra.filter(b => b.id !== id);
  }
  guardarBibLocal();
  pintarBiblioteca();
}

function agregarABiblioteca() {
  const b = estado.bloques.find(x => x.id === selId);
  if (!b) { aviso('Primero selecciona un elemento del plano'); return; }
  const foto = (b.foto && fotos[b.foto]) ? fotos[b.foto] : null;
  if (!foto) { aviso('Ese elemento no tiene foto: selecciona uno con imagen'); return; }
  bibExtra.push({ id: 'u' + Date.now(), nombre: b.nombre, a: b.a, f: b.f, h: b.h, foto: foto });
  guardarBibLocal();
  pintarBiblioteca();
  ok(b.nombre + ' agregado a la biblioteca');
}

/* ============================================================
   INICIALIZACIÓN
   ============================================================ */
async function iniciar() {
  const on = (id, ev, fn) => { const el = $(id); if (el) el.addEventListener(ev, fn); };

  /* ---------- taller ---------- */
  on('btnCrearBodega', 'click', () => crearBodega());
  on('btnAgregar', 'click', agregarBloque);
  on('btnDeshacer', 'click', deshacer);
  on('btnMenos', 'click', () => cambiarZoom(-0.1));
  on('btnMas', 'click', () => cambiarZoom(0.1));
  on('btnAgregarAb', 'click', agregarAbertura);
  on('pasoMover', 'change', e => { SNAP = parseFloat(e.target.value) || 2; });
  on('espesorMuro', 'change', e => { $('fondoBloque').value = e.target.value; });
  on('verNombres', 'change', e => aplicarEtiquetas(e.target.checked ? 'todas' : 'ninguna', true));
  on('btnEtiquetas', 'click', () => {
    const orden = ['todas', 'areas', 'ninguna'];
    aplicarEtiquetas(orden[(orden.indexOf(modoEtiquetas) + 1) % orden.length], true);
  });

  /* ---------- módulos ---------- */
  $('categoriaBloque').addEventListener('change', () => cambiarCategoria(true));
  document.querySelectorAll('.tipo').forEach(b => {
    b.addEventListener('click', () => elegirTipo(b.dataset.cat));
  });
  document.querySelectorAll('.marca').forEach(b =>
    b.addEventListener('click', () => cambiarTab(b.dataset.tab)));
  ['marcaColor', 'marcaForma', 'marcaAncho'].forEach(id => {
    const el = $(id);
    if (!el) return;
    el.addEventListener('change', () => {
      pintarVistaMarca();
      if (id === 'marcaAncho' && $('anchoMarca')) $('anchoMarca').value = el.value;
    });
  });
  on('btnMarcaSel', 'click', () => aplicarMarca(true));
  on('btnMarcaTodos', 'click', () => aplicarMarca(false));
  on('esStand', 'change', e => { $('standCampos').style.display = e.target.checked ? 'flex' : 'none'; });
  on('esEstante', 'change', e => { $('estanteCampos').style.display = e.target.checked ? 'flex' : 'none'; });

  /* ---------- marcos ---------- */
  on('btnMarcoCrear', 'click', crearMarco);
  on('btnMarcoAplicar', 'click', aplicarMedidasMarco);

  /* ---------- biblioteca ---------- */
  const bodBib = $('bodega');
  bodBib.addEventListener('dragover', e => e.preventDefault());
  bodBib.addEventListener('drop', e => {
    const id = e.dataTransfer.getData('text/plain');
    if (!id) return;
    e.preventDefault();
    crearDesdeBib(id, e.clientX, e.clientY);
  });
  on('btnBibAdd', 'click', agregarABiblioteca);
  on('btnBibNuevo', 'click', agregarBibDesdeForm);
  on('btnBibRestaurar', 'click', restaurarBiblioteca);

  /* ---------- edificación destino ---------- */
  on('dentroDe', 'change', () => {
    const ed = dentroSeleccionado();
    if (!ed) return;
    const cat = $('categoriaBloque').value;
    if (cat === 'muro') {
      $('anchoBloque').value = ed.a;
      aviso('Muro del ancho de ' + ed.nombre + ' (puedes ajustarlo)');
    } else if (cat === 'objeto') {
      const disp = medidasDisponibles(ed);
      const a = num($('anchoBloque').value, 1.6), f = num($('fondoBloque').value, 1);
      if (a > disp.a - 0.2 || f > disp.f - 0.2) {
        $('anchoBloque').value = Math.max(0.3, Math.min(a, disp.a - 0.2)).toFixed(2);
        $('fondoBloque').value = Math.max(0.3, Math.min(f, disp.f - 0.2)).toFixed(2);
        aviso('Ajusté las medidas para que quepan en ' + ed.nombre);
      }
    }
  });

  /* ---------- colocar con un clic ---------- */
  const bod = $('bodega');
  bod.addEventListener('pointermove', moverFantasma);
  bod.addEventListener('click', e => {
    if (!colocando) return;
    if (e.target.closest('.bloque-wrapper, .ab-ov, #fantasma')) return;
    const r = bod.getBoundingClientRect();
    const px = (e.clientX - r.left) / zoomActual - (colocando.b.a * ESCALA) / 2;
    const py = (e.clientY - r.top) / zoomActual - (colocando.b.f * ESCALA) / 2;
    colocarEnPunto(Math.round(px / SNAP) * SNAP, Math.round(py / SNAP) * SNAP);
  });
  $('destino').addEventListener('change', refrescarNiveles);

  /* ---------- fotos ---------- */
  ['fotoParedArriba', 'fotoParedAbajo', 'fotoParedIzq', 'fotoParedDer'].forEach(id => {
    const el = $(id); if (el) el.addEventListener('change', () => cargarPared(el));
  });
  document.querySelectorAll('[data-quitar]').forEach(btn => {
    btn.addEventListener('click', () => quitarFotoPared(btn.dataset.quitar));
  });
  on('btnQuitarFotoBloque', 'click', quitarFotoEquipo);

  /* ---------- selección ---------- */
  on('btnSelAplicar', 'click', aplicarSeleccion);
  on('btnSelDup', 'click', duplicarSeleccion);
  on('btnSelDel', 'click', () => { const id = selId; borrarBloque(id); seleccionar(null); });
  on('btnSelCerrar', 'click', () => seleccionar(null));
  on('btnSelCerrarMuro', 'click', cerrarMuroSeleccionado);
  on('btnSelRotar', 'click', () => { const id = selId; rotarBloque(id); if (id) seleccionar(id); });
  on('btnSelQuitarFoto', 'click', quitarFotoSeleccion);
  on('selFoto', 'change', e => {
    const f = e.target.files && e.target.files[0];
    if (!f) return;
    const id = selId;
    cargarFoto(f, url => {
      const aplicar = (u, sil) => {
        const b = estado.bloques.find(x => x.id === id);
        if (!b) return;
        const fid = 'f' + (++fotoSeq);
        fotos[fid] = u;
        b.foto = fid;
        b.silueta = !!sil;
        guardarFotosLocal();
        render(); guardarHistorial(); seleccionar(b.id);
        ok('Foto actualizada');
      };
      if ($('fotoSilueta').checked) recortarFondo(url, out => aplicar(out || url, !!out));
      else aplicar(url, false);
    }, 900);
    e.target.value = '';
  });

  /* ---------- guardar / abrir / compartir ---------- */
  on('btnGuardar', 'click', () => guardarProyecto(true));
  on('btnArchivo', 'click', exportarJSON);
  on('btnCompartirProy', 'click', compartirProyecto);
  on('btnNuevo', 'click', nuevoProyecto);
  on('nombreProyecto', 'input', e => {
    nombreProyecto = (e.target.value || '').trim().slice(0, 60) || 'Taller CTC Energy';
    programarGuardado();
  });
  on('btnExportar', 'click', exportarJSON);
  on('btnImportar', 'click', () => {
    $('fileImportar').dataset.modo = 'reemplazar';
    $('fileImportar').click();
  });
  on('btnAgregarJson', 'click', () => {
    $('fileImportar').dataset.modo = 'agregar';
    $('fileImportar').click();
  });
  $('fileImportar').addEventListener('change', e => {
    const f = e.target.files && e.target.files[0];
    const modo = e.target.dataset.modo || 'reemplazar';
    if (f) importarJSON(f, modo);
    e.target.value = '';
  });
  on('btnBorrarTodo', 'click', () => borrarTodo(false));
  on('imgParedesCompletas', 'change', () => {
    sincronizarExtras();
    if (!MODO_TEST) guardarLocal();
  });
  on('libreSolape', 'change', e => {
    if (e.target.checked) aviso('Modo libre: los elementos pueden quedar encimados');
  });

  /* ---------- 3D / PDF ---------- */
  on('btn3D', 'click', abrir3D);
  on('btnCerrar3D', 'click', cerrar3D);
  on('btnVivo3D', 'click', () => alternarVivo3D());
  on('btnVivoCerrar', 'click', () => alternarVivo3D(false));
  on('btnVivoReset', 'click', () => { vivoZoom = 1; vivoGiro = 0; actualizarVivo3D(); });
  on('btnVivoAbrir', 'click', abrir3D);
  on('btnVivoCompartir', 'click', () => compartir3D(false));
  on('btnImprimir', 'click', imprimir);
  on('btnCompartir3D', 'click', () => compartir3D(false));
  on('btnPng3D', 'click', () => compartir3D(true));
  on('btnCompartir3DView', 'click', () => compartir3D(false));
  on('btnPng3DView', 'click', () => compartir3D(true));

  /* ---------- ayuda ---------- */
  on('btnAyuda', 'click', abrirAyuda);
  on('btnAyudaCerrar', 'click', cerrarAyuda);
  on('btnAyudaCerrar2', 'click', cerrarAyuda);

  /* ---------- panel móvil ---------- */
  const panel = $('panel');
  const abrirPanel = () => {
    panel.classList.add('abierto');
    const b = $('panelBackdrop');
    if (b) b.classList.add('activa');
    $('btn-panel').setAttribute('aria-expanded', 'true');
  };
  const cerrarPanel = () => {
    panel.classList.remove('abierto');
    const b = $('panelBackdrop');
    if (b) b.classList.remove('activa');
    $('btn-panel').setAttribute('aria-expanded', 'false');
  };
  on('btn-panel', 'click', () => {
    if (panel.classList.contains('abierto')) cerrarPanel(); else abrirPanel();
  });
  on('panelBackdrop', 'click', cerrarPanel);
  on('btnCerrarPanel', 'click', cerrarPanel);

  /* ---------- teclado / impresión ---------- */
  window.addEventListener('beforeprint', construirLeyenda);
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape') { cerrar3D(); cancelarColocacion(); cerrarAyuda(); }
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') { e.preventDefault(); deshacer(); }
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') { e.preventDefault(); guardarProyecto(true); }
  });

  /* ---------- 3D: girar y zoom ---------- */
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
  v.addEventListener('wheel', e => {
    e.preventDefault();
    cam.z *= Math.exp(-e.deltaY * 0.001);
    aplicarCamara();
  }, { passive: false });

  /* ---------- 3D en vivo: girar con el dedo ---------- */
  const vl = $('vivoLienzo');
  if (vl) {
    const dist = pts => Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y);
    const soltarPuntero = e => {
      vivoPunteros.delete(e.pointerId);
      if (vivoPunteros.size < 2) vivoPinch = null;
      if (!vivoPunteros.size) vivoDrag = null;
    };
    vl.addEventListener('pointerdown', e => {
      if (e.button !== undefined && e.button !== 0) return;
      try { vl.setPointerCapture(e.pointerId); } catch (_) { }
      vivoPunteros.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (vivoPunteros.size === 1) {
        vivoDrag = { x: e.clientX, giro: vivoGiro };
      } else if (vivoPunteros.size === 2) {
        const pts = Array.from(vivoPunteros.values());
        vivoPinch = { d: Math.max(1, dist(pts)), zoom: vivoZoom };
        vivoDrag = null;
      }
    });
    vl.addEventListener('pointermove', e => {
      if (!vivoPunteros.has(e.pointerId)) return;
      vivoPunteros.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (vivoPunteros.size >= 2 && vivoPinch) {
        const pts = Array.from(vivoPunteros.values()).slice(0, 2);
        vivoZoom = Math.max(0.6, Math.min(2.6, vivoPinch.zoom * dist(pts) / vivoPinch.d));
        programarVivo3D();
        return;
      }
      if (vivoDrag) {
        vivoGiro = vivoDrag.giro + (e.clientX - vivoDrag.x) * 0.008;
        programarVivo3D();
      }
    });
    ['pointerup', 'pointercancel'].forEach(ev => vl.addEventListener(ev, soltarPuntero));
    vl.addEventListener('wheel', e => {
      e.preventDefault();
      vivoZoom = Math.max(0.6, Math.min(2.6, vivoZoom * Math.exp(-e.deltaY * 0.0015)));
      programarVivo3D();
    }, { passive: false });
    vl.addEventListener('dblclick', () => {
      vivoZoom = 1; vivoGiro = 0; actualizarVivo3D();
    });
  }

  /* ---------- mover el panel 3D a otra esquina ---------- */
  const cabVivo = document.querySelector('.vivo-cab');
  if (cabVivo) {
    let arrastreVivo = null;
    const finVivo = () => {
      if (!arrastreVivo) return;
      arrastreVivo = null;
      const panel = $('vivo3d'); if (!panel) return;
      const r = panel.getBoundingClientRect();
      const cx = r.left + r.width / 2, cy = r.top + r.height / 2;
      const pos = (cy < window.innerHeight / 2 ? 't' : 'b') + (cx < window.innerWidth / 2 ? 'l' : 'r');
      panel.style.left = ''; panel.style.top = '';
      panel.style.right = ''; panel.style.bottom = '';
      ubicarVivo3D(pos);
      try { localStorage.setItem('ctc_vivo3d_pos', pos); } catch (_) { }
    };
    cabVivo.addEventListener('pointerdown', e => {
      if (e.target.closest('button')) return;
      const panel = $('vivo3d'); if (!panel) return;
      const r = panel.getBoundingClientRect();
      arrastreVivo = { dx: e.clientX - r.left, dy: e.clientY - r.top };
      panel.style.left = r.left + 'px'; panel.style.top = r.top + 'px';
      panel.style.right = 'auto'; panel.style.bottom = 'auto';
      try { cabVivo.setPointerCapture(e.pointerId); } catch (_) { }
      e.preventDefault();
    });
    cabVivo.addEventListener('pointermove', e => {
      if (!arrastreVivo) return;
      const panel = $('vivo3d'); if (!panel) return;
      const w = panel.offsetWidth, h = panel.offsetHeight;
      const x = Math.max(4, Math.min(window.innerWidth - w - 4, e.clientX - arrastreVivo.dx));
      const y = Math.max(4, Math.min(window.innerHeight - h - 4, e.clientY - arrastreVivo.dy));
      panel.style.left = x + 'px'; panel.style.top = y + 'px';
    });
    ['pointerup', 'pointercancel'].forEach(ev => cabVivo.addEventListener(ev, finVivo));
  }

  /* ---------- guardado al salir / cambiar de app ---------- */
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden' && !MODO_TEST) guardarProyecto(false);
  });
  window.addEventListener('pagehide', () => {
    if (!MODO_TEST) {
      try {
        sincronizarExtras();
        localStorage.setItem(LS_KEY, JSON.stringify({
          version: 2, ancho: estado.ancho, fondo: estado.fondo,
          bloques: estado.bloques, aberturas: estado.aberturas,
          recintos: estado.recintos, extras: documentoProyecto().extras,
          nombre: nombreProyecto
        }));
      } catch (_) { }
    }
  });

  /* ---------- arranque ---------- */
  elegirTipo('objeto');
  SNAP = parseFloat($('pasoMover').value) || 2;
  let modoEt = 'todas';
  try { modoEt = localStorage.getItem('ctc_etiquetas') || 'todas'; } catch (_) { }
  aplicarEtiquetas(modoEt, false);

  await (MODO_TEST ? Promise.resolve(cargarBibLocal()) : cargarBiblioteca());
  if (typeof pintarBiblioteca === 'function') pintarBiblioteca();

  if (MODO_TEST) {
    crearBodega(10.13, 20.45, true);
    marcarGuardado('Modo de prueba', 'ok');
  } else {
    const cargado = await cargarProyectoInicial();
    if (cargado) {
      historial = []; histIdx = -1;
      guardarHistorial();
      marcarGuardado('Proyecto guardado en este dispositivo', 'ok');
    } else {
      crearBodega(estado.ancho, estado.fondo, true);
      marcarGuardado('Proyecto nuevo · se guarda solo', 'pendiente');
    }
  }
  cambiarTab('taller');
  refrescarFotosPared();
  refrescarPaneles();
  if (!MODO_TEST) {
    let pref = null, pos = null;
    try {
      pref = localStorage.getItem('ctc_vivo3d');
      pos = localStorage.getItem('ctc_vivo3d_pos');
    } catch (_) { }
    if (pos) ubicarVivo3D(pos);
    const abrirVivo = pref !== null ? pref === '1' : window.innerWidth >= 1100;
    if (abrirVivo) alternarVivo3D(true, false);
  }

  const q = new URLSearchParams(location.search);
  if (q.has('selftest')) correrTest();
  else if (q.has('test')) await correrTestAsync();

  // PWA: solo en https o localhost
  if ('serviceWorker' in navigator && !MODO_TEST &&
      (location.protocol === 'https:' || location.hostname === 'localhost' || location.hostname === '127.0.0.1')) {
    navigator.serviceWorker.register('sw.js').catch(() => { });
  }
}

let selId = null;

function seleccionar(id) {
  const b = estado.bloques.find(x => x.id === id);
  const box = $('selBox');
  if (!box) return;
  if (!b) {
    selId = null;
    box.style.display = 'none';
    document.querySelectorAll('.bloque-wrapper.sel').forEach(w => w.classList.remove('sel'));
    return;
  }
  selId = id;
  document.querySelectorAll('.bloque-wrapper').forEach(w =>
    w.classList.toggle('sel', w.dataset.id === id));
  box.style.display = 'block';
  const esMarco = b.cat === 'marca';
  $('selInfo').textContent = b.cod + '  ·  ' +
    (esMarco ? textoMarco(b) : (b.a * b.f).toFixed(2) + ' m²' + (b.foto ? '  ·  con foto' : ''));
  $('selNombre').value = b.nombre;
  $('selAncho').value = b.a;
  $('selFondo').value = b.f;
  $('selAlto').value = b.h;
  $('selColor').value = b.color;
  $('selMarca').checked = !!b.marca;
  $('selFoto').value = '';
  const gAlto = $('selAlto') && $('selAlto').closest('.form-group');
  if (gAlto) gAlto.style.display = esMarco ? 'none' : '';
  if ($('btnSelCerrarMuro')) {
    const puede = b.cat === 'muro' && estado.bloques.some(e => e.cat === 'edificacion' && dentroDe(b, e));
    $('btnSelCerrarMuro').style.display = puede ? 'block' : 'none';
  }
  const gColor = $('selColor') && $('selColor').closest('.form-group');
  if (gColor) gColor.style.display = esMarco ? 'none' : '';
  const gMarca = $('selMarca') && $('selMarca').closest('.form-group');
  if (gMarca) gMarca.style.display = esMarco ? 'none' : '';
  const gFoto = $('selFoto') && $('selFoto').closest('.form-group');
  if (gFoto) gFoto.style.display = esMarco ? 'none' : '';
  if (esMarco) {
    if ($('marcoAncho')) $('marcoAncho').value = b.a;
    if ($('marcoFondo')) $('marcoFondo').value = b.f;
    if ($('marcoFranja')) $('marcoFranja').value = b.franja;
  }
  if (b.cat === 'edificacion' && $('dentroDe') && $('dentroDe').value !== b.id) {
    $('dentroDe').value = b.id;
  }
}

function aplicarSeleccion() {
  const b = estado.bloques.find(x => x.id === selId);
  if (!b) { aviso('Selecciona un elemento en el plano'); return; }
  const na = num($('selAncho').value, b.a), nf = num($('selFondo').value, b.f);
  const nh = Math.max(0.1, num($('selAlto').value, b.h));
  if (na <= 0 || nf <= 0) { error('Medidas inválidas'); return; }
  if (b.cat === 'marca') {
    b.a = Math.max(0.3, na); b.f = Math.max(0.3, nf);
    b.nombre = ($('selNombre').value || '').trim() || b.nombre;
    const bod = $('bodega');
    b.x = Math.max(0, Math.min(b.x, bod.clientWidth - b.a * ESCALA));
    b.y = Math.max(0, Math.min(b.y, bod.clientHeight - b.f * ESCALA));
    render(); guardarHistorial(); seleccionar(b.id);
    ok('Marco actualizado');
    return;
  }
  const hijos = b.cat === 'edificacion' ? hijosContenidos(b) : [];
  const wpx = na * ESCALA, hpx = nf * ESCALA;
  const selector = '.bloque-wrapper[data-id="' + b.id + '"]';
  const otro = document.querySelector(selector) || { dataset: { categoria: b.cat } };
  const choca = colisiona(otro, b.x, b.y, wpx, hpx);
  if (choca) {
    const libre = buscarLibre(otro, wpx, hpx, b.x, b.y);
    if (libre) { b.x = libre.x; b.y = libre.y; }
    else aviso('El nuevo tamaño queda encimado; se aplicó igual.');
  }
  b.nombre = ($('selNombre').value || '').trim() || b.nombre;
  b.a = na; b.f = nf; b.h = nh;
  b.color = $('selColor').value;
  b.marca = $('selMarca').checked ? anchoMarcaActual() : null;
  if (b.cat === 'muro') {
    const edM = estado.bloques.find(e => e.cat === 'edificacion' && dentroDe(b, e));
    if (edM) ajustarMuroAEdificacion(b, edM);
  }
  if (hijos.length) {
    hijos.forEach(h => {
      h.x = limitar(h.x, b.x, b.x + b.a * ESCALA - h.a * ESCALA);
      h.y = limitar(h.y, b.y, b.y + b.f * ESCALA - h.f * ESCALA);
    });
    aviso('La edificación cambió: sus elementos se reacomodaron');
  }
  render(); guardarHistorial(); seleccionar(b.id);
  ok('Cambios aplicados');
}

function duplicarSeleccion() {
  const b = estado.bloques.find(x => x.id === selId);
  if (!b) { aviso('Selecciona un elemento'); return; }
  const c = JSON.parse(JSON.stringify(b));
  c.id = nuevoId('b');
  c.cod = siguienteCodigo(c.cat);
  if (!ubicar(c)) return;
  render(); guardarHistorial(); seleccionar(c.id);
  ok('Duplicado');
}

function quitarFotoSeleccion() {
  const b = estado.bloques.find(x => x.id === selId);
  if (!b) return;
  b.foto = null; b.silueta = false;
  render(); guardarHistorial(); seleccionar(b.id);
  aviso('Foto quitada');
}

function marcarPosicion(b) {
  const X = (b.x / ESCALA).toFixed(2);
  const Y = (b.y / ESCALA).toFixed(2);
  const X2 = ((b.x + b.a * ESCALA) / ESCALA).toFixed(2);
  const Y2 = ((b.y + b.f * ESCALA) / ESCALA).toFixed(2);
  aviso(b.nombre + '  →  X ' + X + ' a ' + X2 + ' m  ·  Y ' + Y + ' a ' + Y2 + ' m');
}

function borrarTodo(silencioso) {
  const hayFotos = Object.keys(fotosPared).length > 0;
  if (!silencioso && !confirm('¿Borrar todo el plano?' +
      (hayFotos ? '\n\nTambién se quitarán las fotos de pared del 3D.' : ''))) return false;
  estado = { ancho: estado.ancho, fondo: estado.fondo, bloques: [], aberturas: [], recintos: [], version: 2,
    altoPared: estado.altoPared, cubierta: estado.cubierta,
    alturaCumbrera: estado.alturaCumbrera, colorPared: estado.colorPared,
    imgParedesCompletas: !!estado.imgParedesCompletas };
  Object.keys(fotos).forEach(k => delete fotos[k]);
  guardarFotosLocal();
  limpiarFotosPared();
  const fb = $('fotoBloque'); if (fb) fb.value = '';
  render(); listarAb(); guardarHistorial();
  ok('Lienzo limpio');
  return true;
}

function quitarFotoEquipo() {
  const fb = $('fotoBloque');
  if (fb) fb.value = '';
  aviso('Foto del equipo quitada');
}

const TAM_DEFECTO = {
  objeto: [1.60, 1.00, 1.60],
  edificacion: [3.00, 2.50, 2.60],
  muro: [2.00, 0.15, 2.40],
  libre: [1.00, 0.60, 0.05]
};

const AYUDA = {
  objeto: 'Maquinaria o mobiliario. Puede llevar marcación, foto y quedar dentro de una edificación.',
  edificacion: 'Oficina, baño, almacén, vestier... Se dibuja como cuarto (en 3D sin techo).',
  muro: 'División interna. No choca con nada: puedes ponerlo dentro de una oficina.',
  libre: 'Pasillo, zona peatonal o ruta de evacuación. No ocupa área ni choca con nada.'
};

const CAMPOS = {
  objeto: ['fNombre', 'fMedidas', 'fAlto', 'fPeso', 'fMarca', 'fStand', 'fCant', 'fDestino', 'fColor', 'fFoto'],
  edificacion: ['fNombre', 'fMedidas', 'fAlto', 'fCant', 'fColor', 'fFoto'],
  muro: ['fNombre', 'fMedidas', 'fEspesor', 'fAlto', 'fCant', 'fColor', 'fFoto'],
  libre: ['fNombre', 'fMedidas', 'fCant', 'fColor']
};

const ETIQUETAS = {
  objeto: { nom: 'Nombre del equipo', a: 'Ancho (m)', f: 'Fondo (m)', foto: 'Foto del equipo (opcional)' },
  edificacion: { nom: 'Nombre de la edificación', a: 'Ancho (m)', f: 'Fondo (m)', foto: 'Foto de la fachada (opcional)' },
  muro: { nom: 'Nombre del muro (opcional)', a: 'Largo (m)', f: 'Espesor (m)', foto: 'Textura del muro (opcional)' },
  libre: { nom: 'Nombre de la zona', a: 'Ancho (m)', f: 'Fondo (m)', foto: '' }
};

function mostrarCampos(cat) {
  const visibles = CAMPOS[cat] || CAMPOS.objeto;
  ['fNombre', 'fMedidas', 'fEspesor', 'fAlto', 'fPeso', 'fMarca', 'fStand',
   'fCant', 'fDestino', 'fColor', 'fFoto'].forEach(id => {
    const el = $(id);
    if (el) el.style.display = visibles.indexOf(id) >= 0 ? '' : 'none';
  });
  const e = ETIQUETAS[cat] || ETIQUETAS.objeto;
  if ($('lblNombre')) $('lblNombre').textContent = e.nom;
  if ($('lblAncho')) $('lblAncho').textContent = e.a;
  if ($('lblFondo')) $('lblFondo').textContent = e.f;
  if ($('lblFoto')) $('lblFoto').textContent = e.foto || 'Foto (opcional)';
  // en los muros el espesor se elige en su propio selector
  if ($('fondoBloque')) $('fondoBloque').parentElement.style.display = (cat === 'muro') ? 'none' : '';
  if ($('tipoAyuda')) $('tipoAyuda').textContent = AYUDA[cat] || '';
  if ($('fDentro')) $('fDentro').style.display = (cat === 'objeto' || cat === 'muro') ? '' : 'none';
}

function elegirTipo(cat) {
  fotoPendiente = null;
  $('categoriaBloque').value = cat;
  document.querySelectorAll('.tipo').forEach(b =>
    b.classList.toggle('activo', b.dataset.cat === cat));
  cambiarCategoria(true);
  mostrarCampos(cat);
}

function cambiarCategoria(ponerDefecto) {
  const c = $('categoriaBloque').value;
  $('colorBloque').value = COLORES[c];
  if (c === 'muro' && $('espesorMuro')) $('espesorMuro').value = '0.15';
  if (ponerDefecto && TAM_DEFECTO[c]) {
    const [a, f, al] = TAM_DEFECTO[c];
    $('anchoBloque').value = a;
    $('fondoBloque').value = f;
    $('altoBloque').value = al;
  }
  if (c === 'muro') {
    const ed = (typeof dentroSeleccionado === 'function') ? dentroSeleccionado() : null;
    if (ed && $('anchoBloque')) {
      $('anchoBloque').value = ed.a;
      aviso('Muro del ancho de ' + ed.nombre + ' (ajústalo si es división parcial)');
    }
  }
  mostrarCampos(c);
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
    agregarBloqueAuto();
    return estado.bloques.length === 1 && estado.bloques[0].cod === 'EQ1';
  });

  t('área ocupada = 2 m²', () => Math.abs(areaOcupada() - 2) < 1e-9);

  t('sin solape: segundo bloque se reubica', () => {
    $('nombreBloque').value = 'Equipo 2';
    agregarBloqueAuto();
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
    agregarBloqueAuto();
    const stand = estado.bloques.find(b => b.stand);
    if (!stand) return false;
    refrescarDestinos();
    $('destino').value = stand.id; refrescarNiveles();
    $('nombreBloque').value = 'Caja'; $('anchoBloque').value = 0.5; $('fondoBloque').value = 0.5; $('altoBloque').value = 0.5;
    agregarBloqueAuto();
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
    $('conMarca').checked = true; agregarBloqueAuto();
    return document.querySelectorAll('.franja').length >= 4;
  });

  t('vista 3D genera caras', () => {
    abrir3D();
    const n = document.querySelectorAll('.cara3d').length;
    cerrar3D();
    return n > 10;
  });

  t('quitar foto de pared', () => {
    fotosPared.arriba = 'data:image/png;base64,x';
    marcarFotoPared('arriba', true);
    quitarFotoPared('arriba');
    return !fotosPared.arriba;
  });

  t('borrar todo limpia plano y fotos', () => {
    fotosPared.izq = 'data:image/png;base64,y';
    fotos['f9'] = 'data:image/png;base64,z';
    $('nombreBloque').value = 'Temporal';
    agregarBloqueAuto();
    borrarTodo(true);
    return estado.bloques.length === 0 && estado.aberturas.length === 0 &&
           Object.keys(fotosPared).length === 0 && Object.keys(fotos).length === 0;
  });

  t('muro divisorio con espesor 0.15', () => {
    $('categoriaBloque').value = 'muro';
    cambiarCategoria(true);
    const okDef = (num($('fondoBloque').value) === 0.15);
    $('nombreBloque').value = 'Divisorio';
    agregarBloqueAuto();
    const m = estado.bloques.filter(b => b.cat === 'muro').pop();
    $('categoriaBloque').value = 'objeto';
    cambiarCategoria(true);
    return okDef && !!m && m.cod.indexOf('MD') === 0 && Math.abs(m.f - 0.15) < 1e-9;
  });

  t('3D sin techos no rompe con muros', () => {
    if ($('verTechos')) $('verTechos').checked = false;
    abrir3D();
    const n = document.querySelectorAll('.cara3d').length;
    cerrar3D();
    return n > 8;
  });

  t('colocar con un clic en el punto elegido', () => {
    $('categoriaBloque').value = 'muro';
    cambiarCategoria(true);
    $('nombreBloque').value = 'Divisorio clic';
    iniciarColocacion(leerFormulario(), 1, null);
    const ok = colocarEnPunto(100, 200);
    const m = estado.bloques.filter(b => b.nombre === 'Divisorio clic').pop();
    cancelarColocacion();
    $('categoriaBloque').value = 'objeto';
    cambiarCategoria(true);
    return ok && !!m && Math.abs(m.x - 100) < 1e-6 && Math.abs(m.y - 200) < 1e-6;
  });

  t('huecos de puerta generan piezas de muro', () => {
    const piezas = piezasMuro(200, 100, [{ x: 50, y: 20, wo: 40, ho: 50 }], '#3498db');
    const n = (piezas.match(/<div/g) || []).length;
    return n === 4;
  });

  t('la foto del equipo se usa en 3D', () => {
    fotos['ftest'] = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
    $('nombreBloque').value = 'Equipo con foto';
    $('anchoBloque').value = 2; $('fondoBloque').value = 1.5; $('altoBloque').value = 2;
    agregarBloqueAuto();
    const b = estado.bloques.filter(x => x.nombre === 'Equipo con foto').pop();
    if (!b) return false;
    b.foto = 'ftest';
    abrir3D();
    const conFoto = Array.from(document.querySelectorAll('.cara3d'))
      .some(c => (c.style.backgroundImage || '').indexOf('data:image') > -1);
    cerrar3D();
    return conFoto;
  });

  t('un muro se puede ubicar dentro de una edificación', () => {
    borrarTodo(true);
    $('categoriaBloque').value = 'edificacion'; cambiarCategoria(true);
    $('nombreBloque').value = 'Almacén'; $('anchoBloque').value = 4; $('fondoBloque').value = 3; $('altoBloque').value = 2.6;
    agregarBloqueAuto();
    $('categoriaBloque').value = 'muro'; cambiarCategoria(true);
    $('nombreBloque').value = 'Divisorio interno';
    iniciarColocacion(leerFormulario(), 1, null);
    const ok = colocarEnPunto(20, 20);   // dentro del almacén (0..80, 0..60 px)
    const m = estado.bloques.filter(b => b.nombre === 'Divisorio interno').pop();
    cancelarColocacion();
    $('categoriaBloque').value = 'objeto'; cambiarCategoria(true);
    return ok && !!m && m.x >= 0 && m.x <= 80;
  });

  t('pasos finos: 25 cm, 10 cm y 1 cm', () => {
    const antes = SNAP;
    SNAP = 5;    const p25 = Math.round(11 / SNAP) * SNAP;   // 10 px = 0.50 m
    SNAP = 2;    const p10 = Math.round(11 / SNAP) * SNAP;   // 12 px = 0.60 m
    SNAP = 0.2;  const p1  = Math.round(11 / SNAP) * SNAP;   // 11 px = 0.55 m
    SNAP = antes;
    return p25 === 10 && p10 === 12 && Math.abs(p1 - 11) < 1e-6;
  });

  t('foto recortada se dibuja como imagen 3D (sprite)', () => {
    fotos['fs'] = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
    $('nombreBloque').value = 'Yale';
    $('anchoBloque').value = 0.8; $('fondoBloque').value = 1.6; $('altoBloque').value = 1.6;
    agregarBloqueAuto();
    const b = estado.bloques.filter(x => x.nombre === 'Yale').pop();
    if (!b) return false;
    b.foto = 'fs'; b.silueta = true;
    abrir3D();
    const sp = document.querySelector('.sprite3d');
    const altoOk = sp && Math.abs(parseFloat(sp.style.height) - 1.6 * ESCALA) < 0.5;
    cerrar3D();
    return !!sp && altoOk;
  });

  t('editar medidas de un elemento existente', () => {
    borrarTodo(true);
    $('categoriaBloque').value = 'objeto'; cambiarCategoria(true);
    $('nombreBloque').value = 'Editable';
    $('anchoBloque').value = 2; $('fondoBloque').value = 1; $('altoBloque').value = 2;
    agregarBloqueAuto();
    const b = estado.bloques[estado.bloques.length - 1];
    seleccionar(b.id);
    $('selAncho').value = 3; $('selFondo').value = 2; $('selAlto').value = 2.5;
    $('selNombre').value = 'Editado';
    aplicarSeleccion();
    const m = estado.bloques.find(x => x.id === b.id);
    return m && Math.abs(m.a - 3) < 1e-9 && Math.abs(m.f - 2) < 1e-9 &&
           Math.abs(m.h - 2.5) < 1e-9 && m.nombre === 'Editado';
  });

  t('duplicar el elemento seleccionado', () => {
    const antes = estado.bloques.length;
    duplicarSeleccion();
    return estado.bloques.length === antes + 1;
  });

  t('importar en modo sumar no borra lo existente', () => {
    borrarTodo(true);
    $('categoriaBloque').value = 'objeto'; cambiarCategoria(true);
    $('nombreBloque').value = 'Existente';
    $('anchoBloque').value = 2; $('fondoBloque').value = 1; $('altoBloque').value = 2;
    agregarBloqueAuto();
    const antes = estado.bloques.length;
    aplicarImportacion({
      ancho: 10, fondo: 20,
      bloques: [{ id: 'x1', cod: 'EQ9', cat: 'objeto', nombre: 'Bobinadora', a: 1.6, f: 1.0,
                  h: 1.6, color: '#f1c40f', peso: 0, marca: 20, stand: null, estante: null,
                  foto: null, silueta: false, rot: false, x: 100, y: 100 }],
      aberturas: []
    }, 'agregar');
    return estado.bloques.length === antes + 1 &&
           estado.bloques.some(b => b.nombre === 'Bobinadora');
  });

  t('un equipo entra dentro de una edificación', () => {
    borrarTodo(true);
    $('categoriaBloque').value = 'edificacion'; cambiarCategoria(true);
    $('nombreBloque').value = 'BOBINADO';
    $('anchoBloque').value = 4; $('fondoBloque').value = 4; $('altoBloque').value = 2.6;
    agregarBloqueAuto();
    const ed = estado.bloques[estado.bloques.length - 1];
    $('categoriaBloque').value = 'objeto'; cambiarCategoria(true);
    $('nombreBloque').value = 'Bobinadora';
    $('anchoBloque').value = 1.6; $('fondoBloque').value = 1; $('altoBloque').value = 1.6;
    iniciarColocacion(leerFormulario(), 1, null);
    const ok = colocarEnPunto(ed.x + 20, ed.y + 20);   // justo dentro
    const m = estado.bloques.filter(b => b.nombre === 'Bobinadora').pop();
    cancelarColocacion();
    return ok && !!m && m.x >= ed.x && m.x <= ed.x + 4 * ESCALA;
  });

  t('quitar la marcación de una edificación', () => {
    const ed = estado.bloques.find(b => b.nombre === 'BOBINADO');
    ed.marca = 20;
    seleccionar(ed.id);
    $('selMarca').checked = false;
    aplicarSeleccion();
    return !estado.bloques.find(b => b.nombre === 'BOBINADO').marca;
  });

  t('la biblioteca trae equipos', () => catalogo().length >= 5);

  t('arrastrar de la biblioteca crea el equipo con foto', () => {
    borrarTodo(true);
    const it = catalogo()[0];
    const okc = crearDesdeBib(it.id, 300, 300);
    const b = estado.bloques[estado.bloques.length - 1];
    return okc && !!b && b.nombre === it.nombre && !!b.foto && !!fotos[b.foto];
  });

  t('quitar y volver a poner un objeto de la biblioteca', () => {
    const it = catalogo()[0];
    const antes = catalogo().length;
    quitarDeBib(it.id);
    const medio = catalogo().length;
    bibOcultos = [];
    guardarBibLocal();
    pintarBiblioteca();
    return medio === antes - 1 && catalogo().length === antes;
  });

  t('cambiar de módulo mueve el formulario', () => {
    cambiarTab('equipos');
    const enEq = document.getElementById('formElemento').parentElement.id === 'hostEq';
    cambiarTab('edif');
    const enEd = document.getElementById('formElemento').parentElement.id === 'hostEdif';
    cambiarTab('bodega');
    return enEq && enEd;
  });

  t('marcación con color y forma', () => {
    borrarTodo(true);
    $('marcaColor').value = 'rojo-blanco';
    $('marcaForma').value = 'u';
    $('marcaAncho').value = '30';
    $('categoriaBloque').value = 'objeto'; cambiarCategoria(true);
    $('nombreBloque').value = 'Con marca';
    $('anchoBloque').value = 2; $('fondoBloque').value = 1; $('altoBloque').value = 2;
    agregarBloqueAuto();
    const b = estado.bloques[estado.bloques.length - 1];
    const franjas = document.querySelectorAll('.franja.rojo-blanco').length;
    $('marcaColor').value = 'amarillo-negro';
    $('marcaForma').value = 'perimetro';
    return b.marca === 30 && b.marcaForma === 'u' && b.marcaColor === 'rojo-blanco' && franjas === 3;
  });

  t('los muros dividen la edificación en recintos con área', () => {
    borrarTodo(true);
    $('categoriaBloque').value = 'edificacion'; cambiarCategoria(true);
    $('nombreBloque').value = 'OFICINA';
    $('anchoBloque').value = 4; $('fondoBloque').value = 4; $('altoBloque').value = 2.6;
    agregarBloqueAuto();
    const ed = estado.bloques[estado.bloques.length - 1];
    $('categoriaBloque').value = 'muro'; cambiarCategoria(true);
    $('nombreBloque').value = 'Divisorio';
    $('anchoBloque').value = 4; $('fondoBloque').value = 0.15; $('altoBloque').value = 2.4;
    iniciarColocacion(leerFormulario(), 1, null);
    colocarEnPunto(ed.x, ed.y + 2 * ESCALA - 1.5);
    cancelarColocacion();
    const rs = recintosDe(ed);
    const suma = rs.reduce((t, r) => t + (r.w * r.h) / (ESCALA * ESCALA), 0);
    return rs.length === 2 && suma > 14 && suma < 16;
  });

  t('recintos: dos muros en cruz dan 4 áreas', () => {
    borrarTodo(true);
    $('categoriaBloque').value = 'edificacion'; cambiarCategoria(true);
    $('nombreBloque').value = 'CUARTO'; $('anchoBloque').value = 4; $('fondoBloque').value = 4; $('altoBloque').value = 2.6;
    agregarBloqueAuto();
    const ed = estado.bloques[estado.bloques.length - 1];
    const muro = (a, f, dx, dy, cod) => ({
      id: nuevoId('b'), cod: cod, cat: 'muro', nombre: cod, a: a, f: f, h: 2.4,
      color: '#5d6d7e', peso: 0, marca: null, stand: null, estante: null,
      foto: null, rot: false, x: ed.x + dx, y: ed.y + dy
    });
    estado.bloques.push(muro(4, 0.15, 0, 2 * ESCALA - 1.5, 'MD1'));
    estado.bloques.push(muro(0.15, 4, 2 * ESCALA - 1.5, 0, 'MD2'));
    render();
    const rs = recintosDe(ed);
    const suma = rs.reduce((t, r) => t + r.m2, 0);
    return rs.length === 4 && Math.abs(suma - (16 - 1.1775)) < 0.05;
  });

  t('el nombre del recinto se mantiene al mover el muro', () => {
    borrarTodo(true);
    $('categoriaBloque').value = 'edificacion'; cambiarCategoria(true);
    $('nombreBloque').value = 'OFICINA'; $('anchoBloque').value = 4; $('fondoBloque').value = 4; $('altoBloque').value = 2.6;
    agregarBloqueAuto();
    const ed = estado.bloques[estado.bloques.length - 1];
    const divisorio = {
      id: nuevoId('b'), cod: 'MD1', cat: 'muro', nombre: 'Divisorio', a: 4, f: 0.15,
      h: 2.4, color: '#5d6d7e', peso: 0, marca: null, stand: null, estante: null,
      foto: null, rot: false, x: ed.x, y: ed.y + 2 * ESCALA - 1.5
    };
    estado.bloques.push(divisorio);
    render();
    const rs = recintosDe(ed);
    if (rs.length !== 2) return false;
    renombrarRecinto(rs[0], 'Oficina');
    divisorio.y += 0.3 * ESCALA;
    render();
    const nombres = recintosDe(ed).map(nombreRecinto);
    return nombres.indexOf('Oficina') >= 0 && nombres.filter(n => n === 'Oficina').length === 1;
  });

  t('el marco se crea y se estira con medidas en vivo', () => {
    borrarTodo(true);
    $('categoriaBloque').value = 'objeto'; cambiarCategoria(true);
    $('nombreBloque').value = 'Equipo marco';
    $('anchoBloque').value = 2; $('fondoBloque').value = 1; $('altoBloque').value = 1;
    agregarBloqueAuto();
    const eq = estado.bloques[estado.bloques.length - 1];
    seleccionar(eq.id);
    $('marcoFranja').value = 0.15;
    const creado = crearMarco();
    const marco = estado.bloques.find(b => b.cat === 'marca');
    if (!creado || !marco) return false;
    const antesA = marco.a;
    $('marcoAncho').value = 3; $('marcoFondo').value = 2; $('marcoFranja').value = 0.2;
    aplicarMedidasMarco();
    const m2x = estado.bloques.find(b => b.cat === 'marca');
    return antesA > eq.a && m2x.a === 3 && m2x.f === 2 &&
      Math.abs(m2x.franja - 0.2) < 1e-9 && textoMarco(m2x).indexOf('3.00') === 0;
  });

  t('mover la edificación arrastra muros y equipos', () => {
    borrarTodo(true);
    $('categoriaBloque').value = 'edificacion'; cambiarCategoria(true);
    $('nombreBloque').value = 'TALLER'; $('anchoBloque').value = 5; $('fondoBloque').value = 4; $('altoBloque').value = 2.6;
    agregarBloqueAuto();
    const ed = estado.bloques[estado.bloques.length - 1];
    $('categoriaBloque').value = 'objeto'; cambiarCategoria(true);
    $('nombreBloque').value = 'Dentro'; $('anchoBloque').value = 1; $('fondoBloque').value = 1; $('altoBloque').value = 1;
    const b = leerFormulario();
    colocarDentroDe(ed, b, 1, null, false);
    const obj = estado.bloques.find(x => x.nombre === 'Dentro');
    const muro = {
      id: nuevoId('b'), cod: 'MD1', cat: 'muro', nombre: 'Interno', a: 3, f: 0.15,
      h: 2.4, color: '#5d6d7e', peso: 0, marca: null, stand: null, estante: null,
      foto: null, rot: false, x: ed.x + 10, y: ed.y + 10
    };
    estado.bloques.push(muro);
    render();
    const ox = obj.x, oy = obj.y, mx = muro.x, my = muro.y;
    const n = moverConContenido(ed, 40, 20);
    render();
    return n === 2 && obj.x === ox + 40 && obj.y === oy + 20 &&
      muro.x === mx + 40 && muro.y === my + 20 && dentroDe(obj, ed);
  });

  t('la biblioteca acepta una imagen propia', () => {
    const antes = catalogo().length;
    $('bibNombre').value = 'Transformador';
    $('bibAncho').value = 1.2; $('bibFondo').value = 0.8; $('bibAlto').value = 1.5;
    if ($('bibFoto')) $('bibFoto').value = '';
    agregarBibDesdeForm();
    const item = catalogo().find(x => x.nombre === 'Transformador');
    const bien = !!item && catalogo().length === antes + 1 &&
      !!item.foto && Math.abs(item.h - 1.5) < 1e-9;
    if (item) quitarDeBib(item.id);
    return bien;
  });

  t('el proyecto guarda techo, cubierta y fotos de pared', () => {
    if ($('altoPared')) $('altoPared').value = 4.5;
    if ($('cubierta')) $('cubierta').value = 'aguas';
    if ($('alturaCumbrera')) $('alturaCumbrera').value = 6.5;
    fotosPared.arriba = 'data:image/png;base64,AAA';
    const doc = documentoProyecto();
    if ($('cubierta')) $('cubierta').value = 'plana';
    const bien = doc.extras.altoPared === 4.5 && doc.extras.cubierta === 'aguas' &&
      doc.extras.alturaCumbrera === 6.5 && !!doc.fotosPared.arriba;
    delete fotosPared.arriba;
    return bien;
  });

  t('borrar la edificación borra su contenido', () => {
    borrarTodo(true);
    $('categoriaBloque').value = 'edificacion'; cambiarCategoria(true);
    $('nombreBloque').value = 'BORRAR'; $('anchoBloque').value = 4; $('fondoBloque').value = 4; $('altoBloque').value = 2.4;
    agregarBloqueAuto();
    const ed = estado.bloques[estado.bloques.length - 1];
    estado.bloques.push({
      id: nuevoId('b'), cod: 'MD1', cat: 'muro', nombre: 'M', a: 4, f: 0.15, h: 2.4,
      color: '#5d6d7e', peso: 0, marca: null, stand: null, estante: null,
      foto: null, rot: false, x: ed.x, y: ed.y + 10
    });
    const antes = estado.bloques.length;
    borrarBloque(ed.id, true);
    return antes > 1 && estado.bloques.length === 0 && !estado.bloques.some(b => b.id === ed.id);
  });

  cont.textContent = res.join('\n');
  document.title = (res.some(r => r.startsWith('FAIL')) ? 'FAIL ' : 'OK ') + res.filter(r => r.startsWith('PASS')).length + '/' + res.length;
}

/* ============================================================
   PRUEBAS ASÍNCRONAS (?test=1): guardado y PNG
   ============================================================ */
async function correrTestAsync() {
  const cont = $('selftest');
  if (cont) cont.hidden = false;
  const res = [];
  const t = async (nombre, fn) => {
    try { const r = await fn(); res.push((r ? 'PASS' : 'FAIL') + ' · ' + nombre); }
    catch (e) { res.push('FAIL · ' + nombre + ' (' + e.message + ')'); }
  };

  await t('IndexedDB guarda y devuelve el proyecto', async () => {
    const doc = documentoProyecto();
    await idbPut('proyecto', '__prueba__', doc);
    const otro = await idbGet('proyecto', '__prueba__');
    await idbDel('proyecto', '__prueba__');
    return !!otro && Math.abs(otro.ancho - doc.ancho) < 1e-9 &&
      (otro.bloques || []).length === (doc.bloques || []).length;
  });

  await t('la imagen 3D se genera en PNG', async () => {
    const cv = await imagen3D();
    return !!cv && cv.width === 1600 && cv.height === 1000 && cv.toDataURL().length > 4000;
  });

  await t('el proyecto se puede volver a cargar', async () => {
    const copia = JSON.parse(JSON.stringify(documentoProyecto()));
    aplicarProyecto(copia);
    return Math.abs(estado.ancho - copia.ancho) < 1e-9 &&
      estado.bloques.length === (copia.bloques || []).length;
  });

  const txt = res.join('\n');
  if (cont) cont.textContent = txt;
  document.title = (res.some(r => r.startsWith('FAIL')) ? 'FAIL ' : 'OK ') +
    res.filter(r => r.startsWith('PASS')).length + '/' + res.length;
}

/* arranque */
if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', iniciar);
else iniciar();
