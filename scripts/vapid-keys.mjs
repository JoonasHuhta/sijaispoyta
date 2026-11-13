// Luo puhelinilmoitusten (Web Push) VAPID-avainparin: npm run push:keys
// Lisää tulostuvat arvot Sites-julkaisun salaisuuksiin. Yksityistä avainta ei tallenneta Gitiin.
import { generateVapidKeys } from '../server/webpush.js';
const { publicKey, privateKey } = await generateVapidKeys();
console.log('VAPID_PUBLIC_KEY=' + publicKey);
console.log('VAPID_PRIVATE_KEY=' + privateKey);
console.log('VAPID_SUBJECT=mailto:sijaisvastaava@koulu.fi');
