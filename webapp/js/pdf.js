/**
 * pdf.js — Generación de PDF de cotización y gestión de branding/notas
 */

const Pdf = (() => {

  // ── NOTAS PDF ────────────────────────────────────────────────────
  const DEFAULT_NOTES = [
    'VALORES INCLUIDOS IVA.',
    'Tiempo de entregas aproximados en días hábiles.',
    'Disponibilidades definitivas sujetas a verificación.',
    'Valores pueden cambiar sin previo aviso.',
  ];

  function loadNotes() {
    const saved = localStorage.getItem(CONFIG.NOTES_KEY);
    return saved ? JSON.parse(saved) : [...DEFAULT_NOTES];
  }
  function saveNotes(notes) {
    localStorage.setItem(CONFIG.NOTES_KEY, JSON.stringify(notes));
  }

  // ── BRANDING PDF ─────────────────────────────────────────────────
  function loadBrand() {
    try {
      const saved = localStorage.getItem(CONFIG.BRAND_KEY);
      if (saved) { const d = JSON.parse(saved); return {hdr: d.hdr||null, ftr: d.ftr||null}; }
    } catch(e) {}
    return {hdr: null, ftr: null};
  }
  function saveBrand(hdr, ftr) {
    localStorage.setItem(CONFIG.BRAND_KEY, JSON.stringify({hdr, ftr}));
  }

  // ── DESCARGAR IMAGEN DESDE DRIVE CON TOKEN (evita CORS) ──────────
  async function _downloadDriveImg(fileId) {
    const token = await Auth.ensureToken();
    const resp = await fetch(
      `https://www.googleapis.com/drive/v3/files/${fileId}?alt=media`,
      { headers: { Authorization: 'Bearer ' + token } }
    );
    if (!resp.ok) throw new Error('Drive ' + resp.status);
    const blob = await resp.blob();
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onloadend = () => {
        const b64 = reader.result;
        const img = new Image();
        img.onload = () => {
          const MAX = 500;
          let w = img.width, h = img.height;
          if (w > MAX || h > MAX) {
            if (w > h) { h = Math.round(h * MAX / w); w = MAX; }
            else { w = Math.round(w * MAX / h); h = MAX; }
          }
          const canvas = document.createElement('canvas');
          canvas.width = w; canvas.height = h;
          canvas.getContext('2d').drawImage(img, 0, 0, w, h);
          resolve(canvas.toDataURL('image/jpeg', 0.75));
        };
        img.onerror = () => resolve(b64);
        img.src = b64;
      };
      reader.onerror = reject;
      reader.readAsDataURL(blob);
    });
  }

  // ── PRE-CARGAR IMÁGENES DE DRIVE PARA EL PDF ─────────────────────
  async function preloadImagesForPDF(items) {
    for (const item of items) {
      if (item.imageUrl?.startsWith('data:image')) {
        item._pdfImg = item.imageUrl;
        continue;
      }
      if (!item.driveFileId && !item.imageUrl) continue;
      try {
        if (item.driveFileId) {
          item._pdfImg = await _downloadDriveImg(item.driveFileId);
        } else {
          item._pdfImg = await urlToBase64(item.imageUrl);
        }
      } catch(e) {
        item._pdfImg = '';
      }
    }
  }

  // ── GENERAR PDF ──────────────────────────────────────────────────
  async function generarPDF() {
    const cliente   = document.getElementById('cliente').value.trim();
    const numCot    = document.getElementById('num_cot').value.trim();
    const fechaVal  = document.getElementById('fecha').value;
    const condicion = document.getElementById('condiciones').value;
    const ciudad    = document.getElementById('ciudad').value.trim();
    const contacto  = document.getElementById('contacto').value.trim();
    const validez   = document.getElementById('validez').value;
    const notas     = document.getElementById('notas-extra').value.trim();

    if (!cliente) { toast('Ingresa el nombre del cliente', 'error'); return; }
    if (!window._cotItems.length) { toast('Agrega al menos un producto', 'error'); return; }

    // Botón en modo loading
    const btnPDF = document.querySelector('.btn-generate');
    if (btnPDF) { btnPDF.disabled = true; btnPDF.innerHTML = '<span class="loading-spin"></span> Generando...'; }

    try {
      // Pre-cargar imágenes de Drive
      await preloadImagesForPDF(window._cotItems);

      const {jsPDF} = window.jspdf;
      const doc = new jsPDF({unit:'mm', format:'a4'});
      const W=210, H=297, ML=14, MR=14, CW=W-ML-MR;
      const MESES=['ENERO','FEBRERO','MARZO','ABRIL','MAYO','JUNIO','JULIO','AGOSTO','SEPTIEMBRE','OCTUBRE','NOVIEMBRE','DICIEMBRE'];
      let fechaStr = '';
      if (fechaVal) { const[yr,mo,dy]=fechaVal.split('-'); fechaStr=`${parseInt(dy)} ${MESES[parseInt(mo)-1]} ${yr}`; }

      const OR=[242,101,34], DK=[26,26,26], WH=[255,255,255], LG=[245,245,240], BD=[220,215,208];
      const total = window._cotItems.reduce((s,i) => s+i.cant*i.precio, 0);
      let y=0, pageNum=1;
      const ROW_H=14, FOOT_RESERVE=46, PAGE_BOTTOM=H-FOOT_RESERVE;
      const cols=[12,10,62,12,24,24,CW-12-10-62-12-24-24];

      function hdr() {
        const brand = loadBrand();
        if (brand.hdr) {
          const imgInfo = doc.getImageProperties(brand.hdr);
          const hdrH = Math.min(35, (imgInfo.height / imgInfo.width) * W);
          const fmt = brand.hdr.includes('data:image/png') ? 'PNG' : 'JPEG';
          doc.addImage(brand.hdr, fmt, 0, 0, W, hdrH);
          y = hdrH + 4;
        } else {
          doc.setFillColor(...OR); doc.rect(0,0,W,5,'F');
          doc.setFillColor(...DK); doc.rect(0,5,W,28,'F');
          doc.setFillColor(...OR); doc.circle(ML+10,19,9,'F');
          doc.setTextColor(...WH); doc.setFont('helvetica','bold'); doc.setFontSize(5.5);
          doc.text('Ortho',ML+10,17,{align:'center'}); doc.text('Well',ML+10,21,{align:'center'});
          doc.setTextColor(...WH); doc.setFont('helvetica','bold'); doc.setFontSize(13);
          doc.text('ORTHOWELL SAS',ML+23,14);
          doc.setFont('helvetica','normal'); doc.setFontSize(7); doc.setTextColor(200,200,200);
          doc.text('COMERCIALIZADORA DE PRODUCTOS Y EQUIPOS MÉDICOS',ML+23,19);
          doc.text('NIT: 900441119-4  ·  Régimen Común  ·  Cra 32 #17-02 Brr Maridiaz - Pasto (N)',ML+23,23);
          doc.text('Tel: 602 721 1162  ·  Cel: 318 847 7226  ·  info@orthowell.com.co',ML+23,27);
          doc.setFillColor(...OR); doc.rect(0,33,W,2,'F');
          doc.setTextColor(...DK); doc.setFont('helvetica','bold'); doc.setFontSize(12);
          doc.text('COTIZACIÓN N° '+numCot,W/2,41,{align:'center'});
          y=47;
        }
        const BH=6, lW=110, rW=CW-lW-4, lx=ML, rx=ML+lW+4;
        doc.setFillColor(...LG);
        doc.roundedRect(lx,y,lW,BH*4+2,2,2,'F'); doc.setDrawColor(...BD); doc.roundedRect(lx,y,lW,BH*4+2,2,2,'S');
        doc.roundedRect(rx,y,rW,BH*4+2,2,2,'F'); doc.setDrawColor(...BD); doc.roundedRect(rx,y,rW,BH*4+2,2,2,'S');
        [
          ['Cliente:',cliente.toUpperCase(),'Fecha:',fechaStr],
          ['Id.','','Condiciones:',condicion],
          ['Dirección',ciudad.toUpperCase(),'',''],
          ['Contacto:',contacto.toUpperCase(),'Página',pageNum+' de ?']
        ].forEach((r,i) => {
          const cy=y+5+i*BH;
          doc.setFont('helvetica','bold'); doc.setFontSize(7.5); doc.setTextColor(...DK);
          doc.text(r[0],lx+3,cy); doc.setFont('helvetica','normal'); doc.text(r[1],lx+27,cy);
          doc.setFont('helvetica','bold'); doc.text(r[2],rx+3,cy); doc.setFont('helvetica','normal'); doc.text(r[3],rx+29,cy);
        });
        y += BH*4+8;
        // Tabla encabezado
        doc.setFillColor(...DK); doc.rect(ML,y,CW,7,'F');
        doc.setTextColor(...WH); doc.setFont('helvetica','bold'); doc.setFontSize(7);
        const ths=['IMG','#','DESCRIPCIÓN','CANT','VR UNIT','VR TOTAL','OBSERVACIONES'];
        const tas=['center','center','left','center','right','right','left'];
        let cx=ML;
        ths.forEach((h,i)=>{const tw=cols[i];doc.text(h,cx+(tas[i]==='center'?tw/2:tas[i]==='right'?tw-2:2),y+4.8,{align:tas[i]});cx+=tw;});
        y+=7;
      }

      function ftr() {
        const brand = loadBrand();
        if (brand.ftr) {
          const imgInfo = doc.getImageProperties(brand.ftr);
          const ftrH = Math.min(22, (imgInfo.height / imgInfo.width) * W);
          const fmt = brand.ftr.includes('data:image/png') ? 'PNG' : 'JPEG';
          doc.addImage(brand.ftr, fmt, 0, H-ftrH, W, ftrH);
        } else {
          const p = (typeof App !== 'undefined') ? App.getProfile() : null;
          const vendNombre = p?.nombre  || 'Andres Felipe Ortega Bravo';
          const vendCargo  = p?.cargo   || 'Gerente Comercial y de Proyectos';
          const vendTel    = p?.telefono || '+57 310 377 5719';
          const vendEmail  = p?.emailVendedor || 'andres.ortega@orthowell.com.co';
          doc.setFillColor(...OR); doc.rect(0,H-18,W,18,'F');
          doc.setTextColor(...WH); doc.setFont('helvetica','bold'); doc.setFontSize(9);
          doc.text(vendNombre,ML+2,H-11);
          doc.setFont('helvetica','normal'); doc.setFontSize(7.5);
          doc.text(vendCargo,ML+2,H-6.5);
          doc.setFont('helvetica','bold'); doc.setFontSize(8);
          doc.text(vendTel,W/2,H-11,{align:'center'});
          doc.setFont('helvetica','normal'); doc.setFontSize(7.5);
          doc.text(vendEmail,W/2,H-6.5,{align:'center'});
        }
      }

      function notesTotal() {
        const bY=y+4;
        doc.setFillColor(...LG); doc.roundedRect(ML,bY,CW*0.62,30,2,2,'F');
        doc.setDrawColor(...BD); doc.roundedRect(ML,bY,CW*0.62,30,2,2,'S');
        doc.setFont('helvetica','bold'); doc.setFontSize(8); doc.setTextColor(...DK);
        doc.text('Notas:',ML+3,bY+6);
        doc.setFont('helvetica','normal'); doc.setFontSize(7.2);
        const p = (typeof App !== 'undefined') ? App.getProfile() : null;
        const savedNotes = p?.notas || loadNotes();
        const nl = savedNotes.map(n => '• ' + n);
        nl.push(`• Validez de la oferta: ${validez}.`);
        if (notas) nl.push('• '+notas);
        nl.forEach((l,i) => doc.text(l,ML+3,bY+12+i*4.2));
        doc.setFont('helvetica','bold'); doc.setFontSize(6.5); doc.setTextColor(110,110,110);
        doc.text('Cta. Ahorros N° 203 090 634 · Banco AV Villas · Titular: ORTHOWELL SAS',ML+3,bY+37);
        const tx=ML+CW*0.64, tW=CW*0.36;
        doc.setFillColor(...DK); doc.roundedRect(tx,bY,tW,18,2,2,'F');
        doc.setTextColor(...WH); doc.setFont('helvetica','bold'); doc.setFontSize(8);
        doc.text('TOTAL (IVA INCL.)',tx+tW/2,bY+7,{align:'center'});
        doc.setFontSize(14); doc.setTextColor(...OR);
        doc.text('$'+fNum(total),tx+tW/2,bY+14.5,{align:'center'});
      }

      hdr();

      window._cotItems.forEach((item, idx) => {
        if (y+ROW_H > PAGE_BOTTOM) { notesTotal(); ftr(); doc.addPage(); pageNum++; y=0; hdr(); }
        if (idx%2===0) { doc.setFillColor(250,250,248); doc.rect(ML,y,CW,ROW_H,'F'); }
        doc.setDrawColor(...BD); doc.line(ML,y+ROW_H,ML+CW,y+ROW_H);

        const iS=ROW_H-2;
        // Imagen: preferir base64 pre-cargada, luego imageUrl si ya es base64, luego nada
        const imgData = item._pdfImg || (item.imageUrl?.startsWith('data:image') ? item.imageUrl : null);
        if (imgData) {
          try {
            const fmt = imgData.includes('data:image/png') ? 'PNG' : 'JPEG';
            doc.addImage(imgData, fmt, ML+1, y+1, iS, iS);
          } catch(e) {
            doc.setFillColor(235,235,232); doc.roundedRect(ML+1,y+1,iS,iS,1,1,'F');
          }
        } else {
          doc.setFillColor(235,235,232); doc.roundedRect(ML+1,y+1,iS,iS,1,1,'F');
        }

        doc.setFont('helvetica','normal'); doc.setFontSize(7.5); doc.setTextColor(...DK);
        let cx=ML+cols[0];
        [{v:String(idx+1),a:'center'},{v:item.nombre,a:'left'},{v:String(item.cant),a:'center'},
         {v:fNum(item.precio),a:'right'},{v:fNum(item.cant*item.precio),a:'right'},{v:item.obs||'',a:'left'}]
          .forEach((cell,ci) => {
            const tw=cols[ci+1];
            if(ci===1){doc.text(doc.splitTextToSize(cell.v,tw-3).slice(0,2),cx+2,y+5);}
            else{doc.text(cell.v,cx+(cell.a==='center'?tw/2:cell.a==='right'?tw-2:2),y+ROW_H/2+1,{align:cell.a});}
            cx+=tw;
          });
        y+=ROW_H;
      });

      notesTotal(); ftr();
      const fn = `COT_${numCot.replace(/[^a-zA-Z0-9]/g,'_')}_${cliente.substring(0,20).replace(/\s+/g,'_').toUpperCase()}.pdf`;
      doc.save(fn);
      toast('✅ PDF generado exitosamente', 'success');
    } catch(e) {
      toast('Error al generar PDF: ' + e.message, 'error');
      console.error(e);
    } finally {
      if (btnPDF) { btnPDF.disabled = false; btnPDF.innerHTML = '⬇️ Generar Cotización PDF'; }
    }
  }

  // ── PUBLIC API ───────────────────────────────────────────────────
  return {
    generarPDF,
    loadNotes,
    saveNotes,
    loadBrand,
    saveBrand,
    DEFAULT_NOTES,
  };
})();
