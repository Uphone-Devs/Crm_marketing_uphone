const express = require('express');
const os = require('os');
const router = express.Router();
const { authMiddleware, requireRole } = require('../middleware/auth.middleware');
const { getConnectedStats } = require('../wsServer');

function getCpuUsage() {
    return new Promise((resolve) => {
        const cpus1 = os.cpus();
        setTimeout(() => {
            const cpus2 = os.cpus();
            let totalIdle = 0, totalTick = 0;
            cpus1.forEach((cpu, i) => {
                const cpu2 = cpus2[i];
                for (const type in cpu2.times) {
                    totalTick += cpu2.times[type] - cpu.times[type];
                }
                totalIdle += cpu2.times.idle - cpu.times.idle;
            });
            const usage = Math.round((1 - totalIdle / totalTick) * 100);
            resolve(Math.max(0, Math.min(100, usage)));
        }, 200);
    });
}

router.get('/sysinfo', authMiddleware, requireRole('admin', 'supervisor'), async (req, res) => {
    try {
        const cpuUsage = await getCpuUsage();
        const totalMem = os.totalmem();
        const freeMem = os.freemem();
        const usedMem = totalMem - freeMem;

        res.json({
            cpu: {
                usage: cpuUsage,
                cores: os.cpus().length,
                model: os.cpus()[0]?.model?.trim() || 'N/A'
            },
            memory: {
                total: totalMem,
                used: usedMem,
                free: freeMem,
                usedPercent: Math.round((usedMem / totalMem) * 100)
            },
            uptime: os.uptime(),
            platform: os.platform(),
            hostname: os.hostname()
        });
    } catch (err) {
        res.status(500).json({ error: 'Error obteniendo info del sistema' });
    }
});

router.get('/connected', authMiddleware, requireRole('admin', 'supervisor'), (req, res) => {
    res.json(getConnectedStats());
});

module.exports = router;
