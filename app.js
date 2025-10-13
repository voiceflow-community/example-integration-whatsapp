'use strict'
require('dotenv').config()
const WHATSAPP_VERSION = process.env.WHATSAPP_VERSION || 'v18.0'
const WHATSAPP_TOKEN = process.env.WHATSAPP_TOKEN
const VERIFY_TOKEN = process.env.VERIFY_TOKEN

const VF_API_KEY = process.env.VF_API_KEY || process.env.VOICEFLOW_API_KEY
const VF_VERSION_ID = process.env.VF_VERSION_ID || 'development'
const VF_PROJECT_ID = process.env.VF_PROJECT_ID || null

if (!WHATSAPP_TOKEN || !VF_API_KEY || !VERIFY_TOKEN) {
  console.error('Missing environment variables')
  process.exit(1)
}

const fs = require('fs')

const PICOVOICE_API_KEY = process.env.PICOVOICE_API_KEY || null
const BLOB_READ_WRITE_TOKEN = process.env.BLOB_READ_WRITE_TOKEN || null

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
  body_parser = require('body-parser'),
  axios = require('axios').default,
  app = express().use(body_parser.json())

app.listen(process.env.PORT || 3000, () => console.log('webhook is listening'))

app.get('/', (req, res) => {
  res.json({
    success: true,
    info: 'WhatsApp API v1.1.3 | V⦿iceflow | 2024',
    status: 'healthy',
    error: null,
  })
})

// Accepts POST requests at /webhook endpoint
app.post('/webhook', async (req, res) => {
  try {
    if (!req.body.object) {
      return res.status(400).json({ message: 'error | unexpected body' })
    }

    const change = req.body?.entry?.[0]?.changes?.[0]
    const message = change?.value?.messages?.[0]
    if (!message) {
      return res.status(200).json({ message: 'ok' })
    }

    const phone_number_id = change.value.metadata.phone_number_id
    user_id = message.from
    user_name = change.value?.contacts?.[0]?.profile?.name
    const inboundMessageId = message.id

    const handleAction = async (action) => {
      await sendTypingIndicator(phone_number_id, user_id)
      let interactError
      try {
        await interact(user_id, action, phone_number_id, user_name)
      } catch (err) {
        interactError = err
      } finally {
        if (inboundMessageId) {
          await sendReadReceipt(phone_number_id, inboundMessageId)
        }
      }

      if (interactError) {
        throw interactError
      }
    }

    if (message.text) {
      await handleAction({
        type: 'text',
        payload: message.text.body,
      })
    } else if (message?.image && BLOB_READ_WRITE_TOKEN) {
      // Handle incoming images from WhatsApp
      try {
        console.log('Processing WhatsApp image...')
        
        // 1. Get image URL from Meta
        const mediaURL = await axios({
          method: 'GET',
          url: `https://graph.facebook.com/${WHATSAPP_VERSION}/${message.image.id}`,
          headers: {
            'Content-Type': 'application/json',
            Authorization: 'Bearer ' + WHATSAPP_TOKEN,
          },
        })

        // 2. Download image from Meta
        const imageResponse = await axios({
          method: 'GET',
          url: mediaURL.data.url,
          headers: {
            Authorization: 'Bearer ' + WHATSAPP_TOKEN,
          },
          responseType: 'arraybuffer',
        })

        // 3. Upload to Vercel Blob
        const { put } = require('@vercel/blob')
        const mimeType = mediaURL.data.mime_type || 'image/jpeg'
        const ext = mimeType.split('/')[1] || 'jpg'
        const { url: publicUrl } = await put(
          `whatsapp-${Date.now()}.${ext}`,
          Buffer.from(imageResponse.data),
          {
            access: 'public',
            token: BLOB_READ_WRITE_TOKEN,
            contentType: mimeType,
          }
        )

        console.log('Image uploaded to:', publicUrl)

        // 4. Send public URL to Voiceflow
        await handleAction({
          type: 'text',
          payload: publicUrl,
        })
      } catch (err) {
        console.error('Failed to process image:', err.response?.data || err.message)
        await handleAction({
          type: 'text',
          payload: 'Sorry, I could not process that image.',
        })
      }
    } else if (message?.audio?.voice === true && PICOVOICE_API_KEY) {
      const mediaURL = await axios({
        method: 'GET',
        url: `https://graph.facebook.com/${WHATSAPP_VERSION}/${message.audio.id}`,
        headers: {
          'Content-Type': 'application/json',
          Authorization: 'Bearer ' + WHATSAPP_TOKEN,
        },
      })

      const rndFileName =
        'audio_' + Math.random().toString(36).substring(7) + '.ogg'

      const audioResponse = await axios({
        method: 'GET',
        url: mediaURL.data.url,
        headers: {
          Authorization: 'Bearer ' + WHATSAPP_TOKEN,
        },
        responseType: 'stream',
      })

      await new Promise((resolve, reject) => {
        const engineInstance = new Leopard(PICOVOICE_API_KEY)
        const wstream = fs.createWriteStream(rndFileName)
        audioResponse.data.pipe(wstream)

        wstream.on('finish', () => {
          ;(async () => {
            try {
              console.log('Analysing Audio file')
              const { transcript } = engineInstance.processFile(rndFileName)
              engineInstance.release()
              fs.unlinkSync(rndFileName)
              if (transcript && transcript !== '') {
                console.log('User audio:', transcript)
                await handleAction({
                  type: 'text',
                  payload: transcript,
                })
              }
              resolve()
            } catch (err) {
              engineInstance.release()
              fs.unlinkSync(rndFileName)
              reject(err)
            }
          })()
        })

        wstream.on('error', (err) => {
          engineInstance.release()
          reject(err)
        })
      })
    } else if (message?.interactive?.button_reply) {
      const buttonReply = message.interactive.button_reply
      if (buttonReply.id.includes('path-')) {
        await handleAction({
          type: buttonReply.id,
          payload: {
            label: buttonReply.title,
          },
        })
      } else {
        await handleAction({
          type: 'intent',
          payload: {
            query: buttonReply.title,
            intent: {
              name: buttonReply.id,
            },
            entities: [],
          },
        })
      }
    }

    res.status(200).json({ message: 'ok' })
  } catch (error) {
    console.error('Error:', error.response?.data || error.message)
    res.status(500).json({ message: 'error' })
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

async function sendTypingIndicator(phone_number_id, to) {
  try {
    const attempts = [
      {
        messaging_product: 'whatsapp',
        recipient_type: 'individual',
        to,
        type: 'typing',
        typing: { type: 'text' },
      },
      {
        messaging_product: 'whatsapp',
        to,
        type: 'action',
        action: { typing: 'typing' },
      },
      {
        messaging_product: 'whatsapp',
        to,
        status: 'typing',
      },
    ]

    for (const payload of attempts) {
      try {
        await axios({
          method: 'POST',
          url: `https://graph.facebook.com/${WHATSAPP_VERSION}/${phone_number_id}/messages`,
          headers: {
            'Content-Type': 'application/json',
            Authorization: 'Bearer ' + WHATSAPP_TOKEN,
          },
          data: payload,
        })
        return
      } catch (err) {
        const code = err.response?.data?.error?.code
        if (code !== 100) {
          throw err
        }
      }
    }
    console.warn('Typing indicator not supported by current WhatsApp API version')
  } catch (error) {
    console.error(
      'Failed to send typing indicator:',
      error.response?.data || error.message
    )
  }
}

async function sendReadReceipt(phone_number_id, messageId) {
  try {
    await axios({
      method: 'POST',
      url: `https://graph.facebook.com/${WHATSAPP_VERSION}/${phone_number_id}/messages`,
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Bearer ' + WHATSAPP_TOKEN,
      },
      data: {
        messaging_product: 'whatsapp',
        status: 'read',
        message_id: messageId,
      },
    })
  } catch (error) {
    console.error(
      'Failed to send read receipt:',
      error.response?.data || error.message
    )
  }
}

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
