import { runFullSettle } from '../services/galaxySettleService.js';

runFullSettle()
    .then(() => {
        console.log('Done.');
        process.exit(0);
    })
    .catch((err) => {
        console.error('Galaxy settle failed:', err);
        process.exit(1);
    });
