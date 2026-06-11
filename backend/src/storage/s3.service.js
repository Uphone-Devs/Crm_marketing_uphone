const fs = require('fs');
const path = require('path');

// Almacenamiento local temporal para emular S3
const UPLOADS_DIR = path.join(__dirname, '../../uploads');

if (!fs.existsSync(UPLOADS_DIR)) {
    fs.mkdirSync(UPLOADS_DIR, { recursive: true });
}

/**
 * Genera una URL Prefirmada. 
 * En modo local, retorna una URL estática hacia el endpoint de Express configurado para archivos locales.
 */
async function generarPresignedUrl(fileName) {
    console.log(`[MOCK S3] Generando URL simulada para: ${fileName}`);
    // En el futuro: devolver URL de S3. Ahora devuelve un endpoint local
    return `http://localhost:${process.env.PORT || 3001}/uploads/${fileName}`;
}

/**
 * Simula subir el archivo (aunque en modo local el archivo ya se enviaría por multipart/form-data o se mueve de temp).
 * Por ahora es un stub que confirma éxito.
 */
async function subirGrabacion(tempFilePath, cdrId) {
    const fileName = `grabacion_${cdrId}.opus`;
    const destPath = path.join(UPLOADS_DIR, fileName);
    
    return new Promise((resolve, reject) => {
        fs.copyFile(tempFilePath, destPath, (err) => {
            if (err) return reject(err);
            console.log(`[MOCK S3] Archivo guardado localmente: ${destPath}`);
            resolve(`http://localhost:${process.env.PORT || 3001}/uploads/${fileName}`);
        });
    });
}

module.exports = {
    generarPresignedUrl,
    subirGrabacion
};
