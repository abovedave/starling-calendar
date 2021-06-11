const fastify = require('fastify')({ logger: true })

const Starling = require('starling-developer-sdk')
const ics = require('ics')

const dayjs = require('dayjs')
const utc = require('dayjs/plugin/utc')
dayjs.extend(utc)

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

  const standingOrdersQuery = await client.payment.listStandingOrders({
    accountUid: account.accountUid,
    categoryUid: account.defaultCategory
  }) || []

  const standingOrdersDates = standingOrdersQuery.data.standingOrders
    .filter(i => !i.cancelledAt && i.standingOrderRecurrence)
    .map(i => formatEvent({
      uid: i.paymentOrderUid,
      name: payees[i.payeeUid],
      timestamp: i.standingOrderRecurrence.startDate,
      amount: i.amount,
      reference: i.reference,
      recurrenceRule: i.standingOrderRecurrence
    }, 'SO'))

  const directDebitsQuery = await client.mandate.listMandates() || []

  const directDebitsDates = directDebitsQuery.data.mandates
    .filter(i => !i.cancelled && i.lastPayment)
    .map(i => formatEvent({
      uid: i.uid,
      name: i.originatorName,
      timestamp: i.lastPayment.lastDate,
      amount: i.lastPayment.lastAmount,
      reference: i.reference
    }, 'DD_SETTLED'))

  const directDebitsUpcomingQuery = await client.feedItem.getFeedItemsBetween({
    accountUid: account.accountUid,
    categoryUid: account.defaultCategory,
    minTransactionTimestamp: dayjs().toISOString(),
    maxTransactionTimestamp: dayjs().add(10, 'day').toISOString()
  }) || []

  const directDebitsUpcomingDates = directDebitsUpcomingQuery.data.feedItems 
    .filter(i => i.source === 'DIRECT_DEBIT' && i.status === 'UPCOMING')
    .map(i => formatEvent({
      uid: i.feedItemUid,
      name: i.counterPartyName,
      timestamp: i.transactionTime,
      amount: i.amount,
      reference: i.reference
    }, 'DD_UPCOMING'))

  return ics.createEvents([
    ...directDebitsDates,
    ...directDebitsUpcomingDates,
    ...standingOrdersDates
  ]).value
})

const formatEvent = (event, type) => {
  let dateObj = dayjs(event.timestamp).utc()

  let eventType = {
    'SO': 'Standing Order',
    'DD_UPCOMING': 'Upcoming Direct Debit',
    'DD_SETTLED': 'Settled Direct Debit'
  }

  let icsObj = {
    productId: "StarlingCalendar",
    uid: event.uid,
    start: dateObj.local().format('YYYY, MM, DD').split(','),
    end: dateObj.local().add(1, 'day').format('YYYY, MM, DD').split(','),
    title: `${event.name} ${formatAmount(event.amount)}`,
    description: `Ref: ${event.reference} (${eventType[type]})`
  }

  if (event.recurrenceRule) icsObj.recurrenceRule = getRrule(event.recurrenceRule)

  return icsObj
}

const getRrule = r => {
  let rule = []

  if (r.frequency) rule.push(`FREQ=${r.frequency}`)
  if (r.count) rule.push(`COUNT=${r.count}`)
  if (r.interval) rule.push(`INTERVAL=${r.interval}`)

  return rule.join(';')
}

const formatAmount = amount => {
  return `(${getSymbolFromCurrency(amount.currency) + (amount.minorUnits / 100).toFixed(2)})`
}

const start = async () => {
  try {
    await fastify.listen(process.env.PORT, '0.0.0.0')
  } catch (err) {
    fastify.log.error(err)
    process.exit(1)
  }
}
start()