const fastify = require('fastify')({ logger: true })

const Starling = require('starling-developer-sdk')
const ics = require('ics')

const dayjs = require('dayjs')
const customParseFormat = require('dayjs/plugin/customParseFormat')
dayjs.extend(customParseFormat)

const productId = "StarlingCalendar"

const getSymbolFromCurrency = require('currency-symbol-map')

fastify.addHook('preHandler', async (req, reply) => {
  const isHttps = ((req.headers['x-forwarded-proto'] || '').substring(0, 5) === 'https')
  if (isHttps) {
    return
  }

  const { method, url } = req.req

  if (method && ['GET', 'HEAD'].includes(method)) {
    const host = req.headers.host || req.hostname
    reply.redirect(301, `https://${host}${url}`)
  }
})

fastify.get('/', async (request, reply) => {
  if (!request.query.personalToken) return reply.code(401).send('Error! Please provide an API key.')
  
  const client = new Starling({
    accessToken: request.query.personalToken
  })

  const accountQuery = await client.account.getAccounts()
  const account = accountQuery.data.accounts[0]

  const payeesQuery = await client.payee.getPayees() || []

  let payees = []
  payeesQuery.data.payees.map(i => {
    payees[i.payeeUid] = i.payeeName
  })

  let dates = []

  const standingOrdersQuery = await client.payment.listStandingOrders({
    accountUid: account.accountUid,
    categoryUid: account.defaultCategory
  }) || []

  standingOrdersQuery.data.standingOrders
    .filter(i => !i.cancelledAt && i.standingOrderRecurrence)
    .forEach(i => {
      dates.push({
        productId,
        uid: i.paymentOrderUid,
        recurrenceRule: rrule(i.standingOrderRecurrence),
        start: formatIcsDate(i.standingOrderRecurrence.startDate),
        end: formatIcsDate(i.standingOrderRecurrence.startDate, true),
        title: `${payees[i.payeeUid]} (${getSymbolFromCurrency(i.amount.currency) + (i.amount.minorUnits / 100).toFixed(2)})`,
        description: `Ref: ${i.reference} (Standing Order)`
      })
    })

  const directDebitsQuery = await client.mandate.listMandates() || []

  directDebitsQuery.data.mandates
    .filter(i => !i.cancelled && i.lastPayment)
    .forEach(i => {
      dates.push({
        productId,
        uid: i.uid,
        start: formatIcsDate(i.lastPayment.lastDate),
        end: formatIcsDate(i.lastPayment.lastDate, true),
        title: `${i.originatorName} (${getSymbolFromCurrency(i.lastPayment.lastAmount.currency) + (i.lastPayment.lastAmount.minorUnits / 100).toFixed(2)})`,
        description: `Ref: ${i.reference} (Direct Debit)`
      })
    })

  return ics.createEvents(dates).value
})

const rrule = r => {
  let rule = []

  if (r.frequency) rule.push(`FREQ=${r.frequency}`)
  if (r.count) rule.push(`COUNT=${r.count}`)
  if (r.interval) rule.push(`INTERVAL=${r.interval}`)

  return rule.join(';')
}

const formatIcsDate = (ts, nextDay) => {
  let dateObj = dayjs(ts)

  if (nextDay) dateObj.add(1, 'day')

  return [dateObj.format('YYYY'), dateObj.format('MM'), dateObj.format('DD')]
}

const start = async () => {
  try {
    await fastify.listen(443)
  } catch (err) {
    fastify.log.error(err)
    process.exit(1)
  }
}
start()