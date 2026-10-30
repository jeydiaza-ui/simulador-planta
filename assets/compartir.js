/* ============================================================
   CTC Energy · Vista 3D isométrica en PNG + compartir
   Sin dependencias. Expone window.CTC3D.render(doc) -> Promise<canvas>
   ============================================================ */
(function (global) {
    'use strict';

    const COS = Math.cos(Math.PI / 6);
    const SIN = Math.sin(Math.PI / 6);
    const W = 1600, H = 1000;

    const IMG_CACHE = new Map();
    function cargarImagen(src) {
        if (!src) return Promise.resolve(null);
        if (IMG_CACHE.has(src)) return Promise.resolve(IMG_CACHE.get(src));
        return new Promise(res => {
            const im = new Image();
            im.onload = () => { IMG_CACHE.set(src, im); res(im); };
            im.onerror = () => res(null);
            im.src = src;
        });
    }

    function rgb(hex) {
        let h = String(hex || '#888').replace('#', '');
        if (h.length === 3) h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2];
        const n = parseInt(h, 16);
        if (!isFinite(n)) return [136, 136, 136];
        return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
    }

    function sombra(hex, f) {
        const c = rgb(hex).map(v => Math.max(0, Math.min(255, Math.round(v * f))));
        return 'rgb(' + c[0] + ',' + c[1] + ',' + c[2] + ')';
    }

    function texto(ctx, txt, x, y, size, color, align, bold) {
        ctx.font = (bold === false ? '' : '700 ') + size + 'px "Segoe UI", Tahoma, sans-serif';
        ctx.textAlign = align || 'left';
        ctx.textBaseline = 'middle';
        ctx.lineWidth = Math.max(2, size / 7);
        ctx.strokeStyle = 'rgba(255,255,255,.85)';
        ctx.strokeText(txt, x, y);
        ctx.fillStyle = color || '#1B2A3A';
        ctx.fillText(txt, x, y);
    }

    function medir(ctx, txt, size) {
        ctx.font = '700 ' + size + 'px "Segoe UI", Tahoma, sans-serif';
        return ctx.measureText(txt).width;
    }

    async function render(doc, opts) {
        doc = doc || {};
        opts = opts || {};
        const giro = Number(opts.giro) || 0;
        const compacto = !!opts.compacto;
        const cv = document.createElement('canvas');
        cv.width = W; cv.height = H;
        const ctx = cv.getContext('2d');

        const bw = Number(doc.ancho) || 0;
        const bd = Number(doc.fondo) || 0;
        const alto = Number(doc.altoPared) || 4;
        const bloques = (Array.isArray(doc.bloques) ? doc.bloques : []).slice();
        const fotos = doc.fotos || {};
        const usadas = [];
        bloques.forEach(b => { if (b.foto && fotos[b.foto] && usadas.indexOf(b.foto) < 0) usadas.push(b.foto); });
        const imgs = {};
        await Promise.all(usadas.map(async id => { imgs[id] = await cargarImagen(fotos[id]); }));

        /* ---------- proyección (con giro alrededor del centro) ---------- */
        const cx0 = bw / 2, cz0 = bd / 2;
        const cosG = Math.cos(giro), sinG = Math.sin(giro);
        const girar = (x, z) => {
            const dx = x - cx0, dz = z - cz0;
            return [cx0 + dx * cosG - dz * sinG, cz0 + dx * sinG + dz * cosG];
        };
        const bruto = (x, y, z) => {
            const g = girar(x, z);
            return { x: (g[0] - g[1]) * COS, y: (g[0] + g[1]) * SIN - y };
        };
        let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
        const ver = (x, y, z) => {
            const p = bruto(x, y, z);
            if (p.x < minX) minX = p.x;
            if (p.x > maxX) maxX = p.x;
            if (p.y < minY) minY = p.y;
            if (p.y > maxY) maxY = p.y;
        };
        ver(0, 0, 0); ver(bw, 0, 0); ver(bw, 0, bd); ver(0, 0, bd);
        ver(0, alto, 0); ver(bw, alto, 0); ver(bw, alto, bd); ver(0, alto, bd);
        bloques.forEach(b => {
            const h = Math.max(0.05, Number(b.h) || 0.05);
            const mx = b.x / 20, mz = b.y / 20;
            ver(mx, 0, mz); ver(mx + b.a, 0, mz + b.f);
            ver(mx, h, mz); ver(mx + b.a, h, mz + b.f);
        });
        if (!isFinite(minX)) { minX = -10; maxX = 10; minY = -10; maxY = 10; }

        const margenX = compacto ? 26 : 70;
        const margenSup = compacto ? 26 : 105;
        const margenInf = compacto ? 26 : 80;
        const escala = Math.min((W - margenX * 2) / Math.max(1, maxX - minX),
                                (H - margenSup - margenInf) / Math.max(1, maxY - minY));
        const offX = (W - (maxX - minX) * escala) / 2 - minX * escala;
        const offY = margenSup + (H - margenSup - margenInf - (maxY - minY) * escala) / 2 - minY * escala;
        const P = (x, y, z) => {
            const p = bruto(x, y, z);
            return { x: p.x * escala + offX, y: p.y * escala + offY };
        };
        const M = v => v / 20;   // px del plano -> metros del modelo

        /* ---------- fondo ---------- */
        const grad = ctx.createLinearGradient(0, 0, 0, H);
        grad.addColorStop(0, '#ffffff');
        grad.addColorStop(1, '#eef2f5');
        ctx.fillStyle = grad;
        ctx.fillRect(0, 0, W, H);

        // suelo (sombra suave)
        const piso = [P(0, 0, 0), P(bw, 0, 0), P(bw, 0, bd), P(0, 0, bd)];
        ctx.save();
        ctx.beginPath();
        ctx.moveTo(piso[0].x, piso[0].y);
        for (let i = 1; i < piso.length; i++) ctx.lineTo(piso[i].x, piso[i].y);
        ctx.closePath();
        ctx.fillStyle = '#f7f9fa';
        ctx.fill();
        ctx.shadowColor = 'rgba(0,0,0,.18)';
        ctx.shadowBlur = 26;
        ctx.shadowOffsetY = 12;
        ctx.fill();
        ctx.restore();

        // cuadrícula de 1 m
        ctx.save();
        ctx.beginPath();
        ctx.moveTo(piso[0].x, piso[0].y);
        for (let i = 1; i < piso.length; i++) ctx.lineTo(piso[i].x, piso[i].y);
        ctx.closePath();
        ctx.clip();
        ctx.strokeStyle = 'rgba(27,42,58,.10)';
        ctx.lineWidth = 1;
        for (let x = 1; x < bw; x++) {
            const a = P(x, 0, 0), b = P(x, 0, bd);
            ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
        }
        for (let z = 1; z < bd; z++) {
            const a = P(0, 0, z), b = P(bw, 0, z);
            ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
        }
        ctx.restore();

        /* ---------- utilidades de dibujo ---------- */
        const poli = (pts, fill, stroke, lw) => {
            ctx.beginPath();
            ctx.moveTo(pts[0].x, pts[0].y);
            for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i].x, pts[i].y);
            ctx.closePath();
            if (fill) { ctx.fillStyle = fill; ctx.fill(); }
            if (stroke) { ctx.strokeStyle = stroke; ctx.lineWidth = lw || 1.4; ctx.stroke(); }
        };
        const linea = (a, b, color, lw) => {
            ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y);
            ctx.strokeStyle = color; ctx.lineWidth = lw || 1; ctx.stroke();
        };

        const caja = (b, h, color, opciones) => {
            opciones = opciones || {};
            const x = M(b.x), z = M(b.y), w = Number(b.a), d = Number(b.f);
            const y0 = 0, y1 = h;
            const top = [P(x, y1, z), P(x + w, y1, z), P(x + w, y1, z + d), P(x, y1, z + d)];
            const der = [P(x + w, y0, z), P(x + w, y1, z), P(x + w, y1, z + d), P(x + w, y0, z + d)];
            const fre = [P(x, y0, z + d), P(x, y1, z + d), P(x + w, y1, z + d), P(x + w, y0, z + d)];
            if (!opciones.sinSombra) {
                // sombra en el piso
                const sh = [P(x + .05, 0, z + .05), P(x + w + .05, 0, z + .05), P(x + w + .05, 0, z + d + .05), P(x + .05, 0, z + d + .05)];
                poli(sh, 'rgba(0,0,0,.10)');
            }
            poli(der, sombra(color, 0.72), 'rgba(0,0,0,.35)', 1);
            poli(fre, sombra(color, 0.86), 'rgba(0,0,0,.35)', 1);
            if (opciones.abierto) {
                // sin tapa: se ve el interior
                poli(top, opciones.colorTapa || 'rgba(255,255,255,.55)', 'rgba(0,0,0,.25)', 1);
            } else {
                poli(top, sombra(color, 1.05), 'rgba(0,0,0,.35)', 1);
            }
            return top;
        };

        /* ---------- capas de piso: zonas libres y marcos ---------- */
        const zonas = bloques.filter(b => b.cat === 'libre');
        zonas.forEach(b => {
            const x0 = M(b.x), z0 = M(b.y), x1 = x0 + Number(b.a), z1 = z0 + Number(b.f);
            poli([P(x0, 0, z0), P(x1, 0, z0), P(x1, 0, z1), P(x0, 0, z1)],
                'rgba(46,204,113,.18)', 'rgba(30,132,73,.55)', 1.2);
        });

        const marcos = bloques.filter(b => b.cat === 'marca');
        marcos.forEach(b => {
            const f = Math.max(0.05, Number(b.franja) || 0.15);
            const x0 = M(b.x), z0 = M(b.y), x1 = x0 + Number(b.a), z1 = z0 + Number(b.f);
            const t = f;
            const color = b.color || '#f1c40f';
            const franjas = [
                [x0, z0, x1, z0 + t], [x0, z1 - t, x1, z1],
                [x0, z0 + t, x0 + t, z1 - t], [x1 - t, z0 + t, x1, z1 - t]
            ];
            franjas.forEach(([a, c, e, g]) => {
                const pts = [P(a, 0, c), P(e, 0, c), P(e, 0, g), P(a, 0, g)];
                poli(pts, color, 'rgba(0,0,0,.45)', 1);
                if (b.marcaColor === 'amarillo-negro' || b.marcaColor === 'rojo-blanco') {
                    // rayas diagonales sobre la franja
                    const n = Math.max(3, Math.round((e - a + g - c) / 26));
                    ctx.save();
                    ctx.beginPath();
                    ctx.moveTo(pts[0].x, pts[0].y);
                    for (let i = 1; i < 4; i++) ctx.lineTo(pts[i].x, pts[i].y);
                    ctx.closePath();
                    ctx.clip();
                    ctx.strokeStyle = b.marcaColor === 'rojo-blanco' ? '#ffffff' : '#111111';
                    ctx.lineWidth = 3;
                    for (let i = -n; i < n * 2; i++) {
                        const sx = pts[0].x + i * 22, sy = pts[0].y;
                        ctx.beginPath(); ctx.moveTo(sx, sy); ctx.lineTo(sx + 60, sy + 60); ctx.stroke();
                    }
                    ctx.restore();
                }
            });
        });

        /* ---------- muros del taller (recorte para ver el interior) ---------- */
        const colPared = doc.colorPared || '#e6e2da';
        const muroBodega = (x0, z0, x1, z1, altoMuro, br) => {
            const pts = [P(x0, 0, z0), P(x0, altoMuro, z0), P(x1, altoMuro, z1), P(x1, 0, z1)];
            poli(pts, sombra(colPared, br), 'rgba(0,0,0,.35)', 1.4);
        };
        // lejanos completos
        muroBodega(0, 0, bw, 0, alto, 1.03);          // fondo (z=0)
        muroBodega(0, 0, 0, bd, alto, 0.94);          // izquierda (x=0)
        // cercanos recortados a 0.45 m para no tapar
        muroBodega(0, bd, bw, bd, 0.45, 0.99);
        muroBodega(bw, 0, bw, bd, 0.45, 0.88);

        /* ---------- edificaciones y muros interiores ---------- */
        const eds = bloques.filter(b => b.cat === 'edificacion');
        eds.forEach(ed => {
            const h = Math.max(0.3, Number(ed.h) || 2.6);
            const x = M(ed.x), z = M(ed.y), w = Number(ed.a), d = Number(ed.f);
            // piso del cuarto
            poli([P(x, 0, z), P(x + w, 0, z), P(x + w, 0, z + d), P(x, 0, z + d)],
                 'rgba(52,152,219,.10)', 'rgba(27,79,114,.35)', 1);
            // paredes: lejanas completas, cercanas recortadas
            muroBodega(x, z, x + w, z, h, 0.96);
            muroBodega(x, z, x, z + d, h, 0.88);
            muroBodega(x, z + d, x + w, z + d, Math.min(h, 0.35), 0.92);
            muroBodega(x + w, z, x + w, z + d, Math.min(h, 0.35), 0.82);
        });

        const muros = bloques.filter(b => b.cat === 'muro');
        muros.forEach(m => caja(m, Math.max(0.3, m.h || 2.4), m.color || '#5D6D7E'));

        /* ---------- equipos: orden por profundidad ---------- */
        const equipos = bloques.filter(b => b.cat === 'objeto');
        equipos.sort((a, b) => (a.x + a.y) - (b.x + b.y));
        equipos.forEach(b => {
            const h = Math.max(0.1, Number(b.h) || 1);
            const img = b.foto ? imgs[b.foto] : null;
            if (b.estante) {
                const p = caja(b, h, b.color || '#aeb6bf', { abierto: true });
                // repisas
                const rep = Math.max(1, (b.estante.repisas || 4));
                const mx = M(b.x), mz = M(b.y), mw = Number(b.a), md = Number(b.f);
                for (let i = 1; i <= rep; i++) {
                    const y = h * i / (rep + 1);
                    poli([P(mx, y, mz), P(mx + mw, y, mz),
                          P(mx + mw, y, mz + md), P(mx, y, mz + md)],
                         'rgba(220,224,228,.9)', 'rgba(0,0,0,.3)', 0.8);
                }
                return;
            }
            if (img) {
                // silueta / foto: imagen de pie sobre el piso
                const base = P(M(b.x) + Number(b.a) / 2, 0, M(b.y) + Number(b.f));
                const wImg = Number(b.a);
                const hImg = h;
                const ratio = img.width && img.height ? img.width / img.height : 1;
                let dw = wImg, dh = wImg / ratio;
                if (dh > hImg) { dh = hImg; dw = hImg * ratio; }
                const anchor = P(M(b.x) + Number(b.a) / 2, 0, M(b.y) + Number(b.f));
                ctx.save();
                ctx.globalAlpha = 0.98;
                ctx.drawImage(img, anchor.x - dw / 2, anchor.y - dh, dw, dh);
                ctx.restore();
                // sombra
                ctx.save();
                ctx.globalAlpha = 0.16;
                const shp = [P(M(b.x), 0, M(b.y) + Number(b.f)), P(M(b.x) + Number(b.a), 0, M(b.y) + Number(b.f)),
                             P(M(b.x) + Number(b.a), 0, M(b.y) + Number(b.f) + 0.06), P(M(b.x), 0, M(b.y) + Number(b.f) + 0.06)];
                poli(shp, '#000');
                ctx.restore();
                if (b.h >= 1.4) {
                    const s = clampSize(wImg, wImg);
                    texto(ctx, b.nombre, base.x, anchor.y + 14, s, '#1B2A3A', 'center');
                }
                return;
            }
            const tapa = caja(b, h, b.color || '#f1c40f');
            if (b.a * b.f >= 1.2) {
                const centro = P(M(b.x) + Number(b.a) / 2, h, M(b.y) + Number(b.f) / 2);
                texto(ctx, b.nombre, centro.x, centro.y, clampSize(Number(b.a) * escala, 16), '#1B2A3A', 'center');
            }
        });

        /* ---------- rótulos de edificaciones ---------- */
        eds.forEach(ed => {
            const h = Math.max(0.3, Number(ed.h) || 2.6);
            const p = P(M(ed.x) + Number(ed.a) / 2, h, M(ed.y));
            const txt = ed.nombre || 'Edificación';
            texto(ctx, txt, p.x, p.y - 14, clampSize(Number(ed.a) * escala * 0.6, 20), '#1B4F72', 'center');
        });

        if (compacto && !bloques.length) {
            texto(ctx, 'Agrega elementos para verlos en 3D', W / 2, H / 2, 52, '#7F8C8D', 'center', false);
        }

        /* ---------- encabezado ---------- */
        if (!compacto) {
        ctx.fillStyle = '#1B2A3A';
        ctx.fillRect(0, 0, W, 8);
        ctx.fillStyle = '#FFC300';
        ctx.fillRect(0, 8, 220, 4);
        texto(ctx, (doc.nombreProyecto || 'Taller CTC Energy'), 60, 52, 34, '#1B2A3A', 'left');
        texto(ctx, 'Vista 3D en perspectiva · ' + bw.toFixed(2) + ' × ' + bd.toFixed(2) + ' m  ·  ' +
                   (bw * bd).toFixed(2) + ' m²', 60, 84, 18, '#566573', 'left', false);
        const fecha = new Date().toLocaleDateString('es-CO', { day: '2-digit', month: '2-digit', year: 'numeric' });
        texto(ctx, fecha, W - 60, 52, 18, '#566573', 'right', false);
        texto(ctx, 'CTC ENERGY', W - 60, 84, 16, '#9AA4AD', 'right');

        /* ---------- pie: escala ---------- */
        const yBase = H - 46;
        ctx.strokeStyle = '#1B2A3A';
        ctx.lineWidth = 2;
        const largoEsc = Math.min(200, 2 * escala);
        ctx.beginPath(); ctx.moveTo(60, yBase); ctx.lineTo(60 + largoEsc, yBase); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(60, yBase - 5); ctx.lineTo(60, yBase + 5); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(60 + largoEsc, yBase - 5); ctx.lineTo(60 + largoEsc, yBase + 5); ctx.stroke();
        texto(ctx, (largoEsc / escala).toFixed(0) + ' m', 60 + largoEsc + 10, yBase, 15, '#1B2A3A', 'left', false);
        texto(ctx, 'Simulador de Planta CTC Energy · ' + equipos.length + ' equipos · ' +
                   eds.length + ' edificaciones · ' + muros.length + ' muros',
              W - 60, yBase, 15, '#7F8C8D', 'right', false);
        }

        return cv;
    }

    function clampSize(ancho, max) {
        return Math.max(9, Math.min(max || 16, ancho * 0.28));
    }

    function aBlob(cv) {
        return new Promise(res => { try { cv.toBlob(b => res(b), 'image/png'); } catch (_) { res(null); } });
    }

    global.CTC3D = { render: render, aBlob: aBlob };
})(window);
