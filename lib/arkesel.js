const axios = require('axios');

const BASE_URL = 'https://sms.arkesel.com/api/v2';

function client() {
  const apiKey = process.env.ARKESEL_API_KEY;
  if (!apiKey) {
    throw new Error('ARKESEL_API_KEY is not set in environment variables');
  }
  return axios.create({
    baseURL: BASE_URL,
    headers: {
      'api-key': apiKey,
      'Content-Type': 'application/json'
    },
    timeout: 15000
  });
}

async function sendSms({ sender, message, recipient, callbackUrl }) {
  const api = client();
  const payload = {
    sender,
    message,
    recipients: [recipient]
  };
  if (callbackUrl) {
    payload.callback_url = callbackUrl;
  }
  const { data } = await api.post('/sms/send', payload);
  return data;
}

async function getSmsStatus(uuid) {
  const api = client();
  const { data } = await api.get(`/sms/${uuid}`);
  return data;
}

async function getBalance() {
  const api = client();
  const { data } = await api.get('/clients/balance-details');
  return data;
}

module.exports = { sendSms, getSmsStatus, getBalance };
