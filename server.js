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
      let dateObj = dayjs(i.standingOrderRecurrence.startDate)

      dates.push({
        productId,
        uid: i.paymentOrderUid,
        recurrenceRule: getRrule(i.standingOrderRecurrence),
        start: dateObj.format('YYYY, MM, DD').split(','),
        end: dateObj.add(1, 'day').format('YYYY, MM, DD').split(','),
        title: `${payees[i.payeeUid]} ${formatAmount(i.amount)}`,
        description: `Ref: ${i.reference} (Standing Order)`
      })
    })

  const directDebitsQuery = await client.mandate.listMandates() || []

  directDebitsQuery.data.mandates
    .filter(i => !i.cancelled && i.lastPayment)
    .forEach(i => {
      let dateObj = dayjs(i.lastPayment.lastDate)

      dates.push({
        productId,
        uid: i.uid,
        start: dateObj.format('YYYY, MM, DD').split(','),
        end: dateObj.add(1, 'day').format('YYYY, MM, DD').split(','),
        title: `${i.originatorName} ${formatAmount(i.lastPayment.lastAmount)}`,
        description: `Ref: ${i.reference} (Direct Debit)`
      })
    })

  const directDebitsUpcomingQuery = await client.feedItem.getFeedItemsBetween({
    accountUid: account.accountUid,
    categoryUid: account.defaultCategory,
    minTransactionTimestamp: dayjs().toISOString(),
    maxTransactionTimestamp: dayjs().add(10, 'day').toISOString()
  }) || []

  directDebitsUpcomingQuery.data.feedItems 
    .filter(i => i.source === 'DIRECT_DEBIT' && i.status === 'UPCOMING')
    .forEach(i => {
        let dateObj = dayjs(i.transactionTime)

        dates.push({
          productId,
          uid: i.feedItemUid,
          start: dateObj.format('YYYY, MM, DD').split(','),
          end: dateObj.add(1, 'day').format('YYYY, MM, DD').split(','),
          title: `${i.counterPartyName} ${formatAmount(i.amount)}`,
          description: `Planned payment. Ref: ${i.reference} (Direct Debit)`
        })
      })

  return ics.createEvents(dates).value
})

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