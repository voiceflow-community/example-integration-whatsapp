'use strict'
require('dotenv').config()
const WHATSAPP_VERSION = process.env.WHATSAPP_VERSION || 'v17.0'
const WHATSAPP_TOKEN = process.env.WHATSAPP_TOKEN

const VF_API_KEY = process.env.VF_API_KEY
const VF_VERSION_ID = process.env.VF_VERSION_ID || 'development'
const VF_PROJECT_ID = process.env.VF_PROJECT_ID || null

const fs = require('fs')

const PICOVOICE_API_KEY = process.env.PICOVOICE_API_KEY || null

const {
  Leopard,
  LeopardActivationLimitReached,
} = require('@picovoice/leopard-node')

let session = 0
let noreplyTimeout = null
let user_id = null
let user_name = null
const VF_TRANSCRIPT_ICON =
  'https://s3.amazonaws.com/com.voiceflow.studio/share/200x200/200x200.png'

const VF_DM_URL =
  process.env.VF_DM_URL || 'https://general-runtime.voiceflow.com'

const DMconfig = {
  tts: false,
  stripSSML: true,
}

const express = require('express'),
// Environment variable validation
const WHATSAPP_TOKEN = process.env.WHATSAPP_TOKEN;
const VOICEFLOW_API_KEY = process.env.VOICEFLOW_API_KEY;
const VOICEFLOW_PROJECT_ID = process.env.VOICEFLOW_PROJECT_ID;
const VERIFY_TOKEN = process.env.VERIFY_TOKEN;

if (!WHATSAPP_TOKEN || !VOICEFLOW_API_KEY || !VOICEFLOW_PROJECT_ID || !VERIFY_TOKEN) {
  console.error('Missing environment variables');
  process.exit(1);
}
  body_parser = require('body-parser'),
  axios = require('axios').default,
  app = express().use(body_parser.json())

app.listen(process.env.PORT || 3000, () => console.log('webhook is listening'))

app.get('/', (req, res) => {
  res.json({
    success: true,
    info: 'WhatsApp API v1.1.2 | V⦿iceflow | 2023',
    status: 'healthy',
    error: null,
  })
})

// Accepts POST requests at /webhook endpoint
app.post('/webhook', async (req, res) => {
  // Parse the request body from the POST
  try {
    const change = req.body?.entry?.[0]?.changes?.[0];
    const message = change?.value?.messages?.[0];
    if (!message) return res.sendStatus(200);
    const from = message.from;
    const metadata = change.value.metadata;
    const phoneNumberId = metadata.phone_number_id;

    let action;
    if (message.type === 'text') {
      action = { type: 'text', payload: message.text.body };
    } else if (message.type === 'interactive' && message.interactive.type === 'button') {
      action = { type: 'choice', payload: message.interactive.button_reply.id };
    } else if (message.type === 'audio') {
      // preserve your custom audio logic
      // ...existing code...
      return res.sendStatus(200);
    } else {
      return res.sendStatus(200); // Ignore unsupported types
    }

    // Typing indicator
    await axios.post(
      `https://graph.facebook.com/v18.0/${phoneNumberId}/messages`,
      { messaging_product: 'whatsapp', to: from, status: 'typing' },
      { headers: { Authorization: `Bearer ${WHATSAPP_TOKEN}` } }
    );

    // Voiceflow API call
    const vfResponse = await axios.post(
      `https://general-runtime.voiceflow.com/state/user/${from}/interact`,
      { action, config: { tts: false, stripSSML: true } },
      {
        headers: {
          Authorization: `Bearer ${VOICEFLOW_API_KEY}`,
          'Content-Type': 'application/json',
          version: VOICEFLOW_PROJECT_ID,
        },
      }
    );

    const output = vfResponse.data.output || [];
    for (const item of output) {
      if (item.type === 'text') {
        await axios.post(
          `https://graph.facebook.com/v18.0/${phoneNumberId}/messages`,
          {
            messaging_product: 'whatsapp',
            to: from,
            type: 'text',
            text: { body: item.payload.message || item.payload },
          },
          { headers: { Authorization: `Bearer ${WHATSAPP_TOKEN}` } }
        );
      } else if (item.type === 'choice' && item.payload.validChoices) {
        const buttons = item.payload.validChoices.slice(0, 3).map(choice => ({
          type: 'reply',
          reply: { id: choice.id, title: choice.label.slice(0, 20) }
        }));
        await axios.post(
          `https://graph.facebook.com/v18.0/${phoneNumberId}/messages`,
          {
            messaging_product: 'whatsapp',
            to: from,
            type: 'interactive',
            interactive: { type: 'button', body: { text: item.payload.prompt || 'اختر:' }, action: { buttons } },
          },
          { headers: { Authorization: `Bearer ${WHATSAPP_TOKEN}` } }
        );
      }
    }

    // Read receipt
    await axios.post(
      `https://graph.facebook.com/v18.0/${phoneNumberId}/messages`,
      { messaging_product: 'whatsapp', to: from, status: 'read' },
      { headers: { Authorization: `Bearer ${WHATSAPP_TOKEN}` } }
    );

    res.sendStatus(200);
  } catch (error) {
    console.error('Error:', error.response?.data || error.message);
    res.sendStatus(500);
  }
})

// Accepts GET requests at the /webhook endpoint. You need this URL to setup webhook initially.
// info on verification request payload: https://developers.facebook.com/docs/graph-api/webhooks/getting-started#verification-requests
app.get('/webhook', (req, res) => {
  const mode = req.query['hub.mode'];
  const token = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];
  if (mode === 'subscribe' && token === VERIFY_TOKEN) {
    console.log('WEBHOOK_VERIFIED');
    return res.status(200).send(challenge);
  }
  res.status(403).send('Forbidden');
})

async function interact(user_id, request, phone_number_id, user_name) {
  clearTimeout(noreplyTimeout)
  if (!session) {
    session = `${VF_VERSION_ID}.${rndID()}`
  }

  await axios({
    method: 'PATCH',
    url: `${VF_DM_URL}/state/user/${encodeURI(user_id)}/variables`,
    headers: {
      Authorization: VF_API_KEY,
      'Content-Type': 'application/json',
    },
    data: {
      user_id: user_id,
      user_name: user_name,
    },
  })

  let response = await axios({
    method: 'POST',
    url: `${VF_DM_URL}/state/user/${encodeURI(user_id)}/interact`,
    headers: {
      Authorization: VF_API_KEY,
      'Content-Type': 'application/json',
      versionID: VF_VERSION_ID,
      sessionID: session,
    },
    data: {
      action: request,
      config: DMconfig,
    },
  })

  let isEnding = response.data.filter(({ type }) => type === 'end')
  if (isEnding.length > 0) {
    console.log('isEnding')
    isEnding = true
    saveTranscript(user_name)
  } else {
    isEnding = false
  }

  let messages = []

  for (let i = 0; i < response.data.length; i++) {
    if (response.data[i].type == 'text') {
      let tmpspeech = ''

      for (let j = 0; j < response.data[i].payload.slate.content.length; j++) {
        for (
          let k = 0;
          k < response.data[i].payload.slate.content[j].children.length;
          k++
        ) {
          if (response.data[i].payload.slate.content[j].children[k].type) {
            if (
              response.data[i].payload.slate.content[j].children[k].type ==
              'link'
            ) {
              tmpspeech +=
                response.data[i].payload.slate.content[j].children[k].url
            }
          } else if (
            response.data[i].payload.slate.content[j].children[k].text != '' &&
            response.data[i].payload.slate.content[j].children[k].fontWeight
          ) {
            tmpspeech +=
              '*' +
              response.data[i].payload.slate.content[j].children[k].text +
              '*'
          } else if (
            response.data[i].payload.slate.content[j].children[k].text != '' &&
            response.data[i].payload.slate.content[j].children[k].italic
          ) {
            tmpspeech +=
              '_' +
              response.data[i].payload.slate.content[j].children[k].text +
              '_'
          } else if (
            response.data[i].payload.slate.content[j].children[k].text != '' &&
            response.data[i].payload.slate.content[j].children[k].underline
          ) {
            tmpspeech +=
              // no underline in WhatsApp
              response.data[i].payload.slate.content[j].children[k].text
          } else if (
            response.data[i].payload.slate.content[j].children[k].text != '' &&
            response.data[i].payload.slate.content[j].children[k].strikeThrough
          ) {
            tmpspeech +=
              '~' +
              response.data[i].payload.slate.content[j].children[k].text +
              '~'
          } else if (
            response.data[i].payload.slate.content[j].children[k].text != ''
          ) {
            tmpspeech +=
              response.data[i].payload.slate.content[j].children[k].text
          }
        }
        tmpspeech += '\n'
      }
      if (
        response.data[i + 1]?.type &&
        response.data[i + 1]?.type == 'choice'
      ) {
        messages.push({
          type: 'body',
          value: tmpspeech,
        })
      } else {
        messages.push({
          type: 'text',
          value: tmpspeech,
        })
      }
    } else if (response.data[i].type == 'speak') {
      if (response.data[i].payload.type == 'audio') {
        messages.push({
          type: 'audio',
          value: response.data[i].payload.src,
        })
      } else {
        if (
          response.data[i + 1]?.type &&
          response.data[i + 1]?.type == 'choice'
        ) {
          messages.push({
            type: 'body',
            value: response.data[i].payload.message,
          })
        } else {
          messages.push({
            type: 'text',
            value: response.data[i].payload.message,
          })
        }
      }
    } else if (response.data[i].type == 'visual') {
      messages.push({
        type: 'image',
        value: response.data[i].payload.image,
      })
    } else if (response.data[i].type == 'choice') {
      let buttons = []
      for (let b = 0; b < response.data[i].payload.buttons.length; b++) {
        let link = null
        if (
          response.data[i].payload.buttons[b].request.payload.actions !=
            undefined &&
          response.data[i].payload.buttons[b].request.payload.actions.length > 0
        ) {
          link =
            response.data[i].payload.buttons[b].request.payload.actions[0]
              .payload.url
        }
        if (link) {
          // Ignore links
        } else if (
          response.data[i].payload.buttons[b].request.type.includes('path-')
        ) {
          let id = response.data[i].payload.buttons[b].request.payload.label
          buttons.push({
            type: 'reply',
            reply: {
              id: response.data[i].payload.buttons[b].request.type,
              title:
                truncateString(
                  response.data[i].payload.buttons[b].request.payload.label
                ) ?? '',
            },
          })
        } else {
          buttons.push({
            type: 'reply',
            reply: {
              id: response.data[i].payload.buttons[b].request.payload.intent
                .name,
              title:
                truncateString(
                  response.data[i].payload.buttons[b].request.payload.label
                ) ?? '',
            },
          })
        }
      }
      if (buttons.length > 3) {
        buttons = buttons.slice(0, 3)
      }
      messages.push({
        type: 'buttons',
        buttons: buttons,
      })
    } else if (response.data[i].type == 'no-reply' && isEnding == false) {
      noreplyTimeout = setTimeout(function () {
        sendNoReply(user_id, request, phone_number_id, user_name)
      }, Number(response.data[i].payload.timeout) * 1000)
    }
  }
  await sendMessage(messages, phone_number_id, user_id)
  if (isEnding == true) {
    session = null
  }
}

async function sendMessage(messages, phone_number_id, from) {
  const timeoutPerKB = 10 // Adjust as needed, 10 milliseconds per kilobyte
  for (let j = 0; j < messages.length; j++) {
    let data
    let ignore = null
    // Image
    if (messages[j].type == 'image') {
      data = {
        messaging_product: 'whatsapp',
        recipient_type: 'individual',
        to: from,
        type: 'image',
        image: {
          link: messages[j].value,
        },
      }
      // Audio
    } else if (messages[j].type == 'audio') {
      data = {
        messaging_product: 'whatsapp',
        recipient_type: 'individual',
        to: from,
        type: 'audio',
        audio: {
          link: messages[j].value,
        },
      }
      // Buttons
    } else if (messages[j].type == 'buttons') {
      data = {
        messaging_product: 'whatsapp',
        recipient_type: 'individual',
        to: from,
        type: 'interactive',
        interactive: {
          type: 'button',
          body: {
            text: messages[j - 1]?.value || 'Make your choice',
          },
          action: {
            buttons: messages[j].buttons,
          },
        },
      }
      // Text
    } else if (messages[j].type == 'text') {
      data = {
        messaging_product: 'whatsapp',
        recipient_type: 'individual',
        to: from,
        type: 'text',
        text: {
          preview_url: true,
          body: messages[j].value,
        },
      }
    } else {
      ignore = true
    }
    if (!ignore) {
      try {
        await axios({
          method: 'POST',
          url: `https://graph.facebook.com/${WHATSAPP_VERSION}/${phone_number_id}/messages`,
          data: data,
          headers: {
            'Content-Type': 'application/json',
            Authorization: 'Bearer ' + WHATSAPP_TOKEN,
          },
        })

        if (messages[j].type === 'image') {
          try {
            const response = await axios.head(messages[j].value)

            if (response.headers['content-length']) {
              const imageSizeKB =
                parseInt(response.headers['content-length']) / 1024
              const timeout = imageSizeKB * timeoutPerKB
              await new Promise((resolve) => setTimeout(resolve, timeout))
            }
          } catch (error) {
            console.error('Failed to fetch image size:', error)
            await new Promise((resolve) => setTimeout(resolve, 5000))
          }
        }
      } catch (err) {
        console.log(err)
      }
    }
  }
}

async function sendNoReply(user_id, request, phone_number_id, user_name) {
  clearTimeout(noreplyTimeout)
  console.log('No reply')
  await interact(
    user_id,
    {
      type: 'no-reply',
    },
    phone_number_id,
    user_name
  )
}

var rndID = function () {
  // Random Number Generator
  var randomNo = Math.floor(Math.random() * 1000 + 1)
  // get Timestamp
  var timestamp = Date.now()
  // get Day
  var date = new Date()
  var weekday = new Array(7)
  weekday[0] = 'Sunday'
  weekday[1] = 'Monday'
  weekday[2] = 'Tuesday'
  weekday[3] = 'Wednesday'
  weekday[4] = 'Thursday'
  weekday[5] = 'Friday'
  weekday[6] = 'Saturday'
  var day = weekday[date.getDay()]
  return randomNo + day + timestamp
}

function truncateString(str, maxLength = 20) {
  if (str) {
    if (str.length > maxLength) {
      return str.substring(0, maxLength - 1) + '…'
    }
    return str
  }
  return ''
}

async function saveTranscript(username) {
  if (VF_PROJECT_ID) {
    if (!username || username == '' || username == undefined) {
      username = 'Anonymous'
    }
    axios({
      method: 'put',
      url: 'https://api.voiceflow.com/v2/transcripts',
      data: {
        browser: 'WhatsApp',
        device: 'desktop',
        os: 'server',
        sessionID: session,
        unread: true,
        versionID: VF_VERSION_ID,
        projectID: VF_PROJECT_ID,
        user: {
          name: username,
          image: VF_TRANSCRIPT_ICON,
        },
      },
      headers: {
        Authorization: process.env.VF_API_KEY,
      },
    })
      .then(function (response) {
        console.log('Transcript Saved!')
      })
      .catch((err) => console.log(err))
  }
  session = `${VF_VERSION_ID}.${rndID()}`
}
