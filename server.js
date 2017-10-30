const applicationRoot = __dirname.replace(/\\/g, '/')
const path = require('path')
const fs = require('fs-extra')
const glob = require('glob')
const morgan = require('morgan')
const colors = require('colors/safe')
const restful = require('sequelize-restful')
const express = require('express')
const helmet = require('helmet')
const errorhandler = require('errorhandler')
const cookieParser = require('cookie-parser')
const serveIndex = require('serve-index')
const favicon = require('serve-favicon')
const bodyParser = require('body-parser')
const cors = require('cors')
const multer = require('multer')
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 200000 } })
const fileUpload = require('./routes/fileUpload')
const redirect = require('./routes/redirect')
const angular = require('./routes/angular')
const easterEgg = require('./routes/easterEgg')
const premiumReward = require('./routes/premiumReward')
const appVersion = require('./routes/appVersion')
const repeatNotification = require('./routes/repeatNotification')
const continueCode = require('./routes/continueCode')
const restoreProgress = require('./routes/restoreProgress')
const fileServer = require('./routes/fileServer')
const keyServer = require('./routes/keyServer')
const authenticatedUsers = require('./routes/authenticatedUsers')
const currentUser = require('./routes/currentUser')
const login = require('./routes/login')
const changePassword = require('./routes/changePassword')
const resetPassword = require('./routes/resetPassword')
const securityQuestion = require('./routes/securityQuestion')
const search = require('./routes/search')
const coupon = require('./routes/coupon')
const basket = require('./routes/basket')
const order = require('./routes/order')
const verify = require('./routes/verify')
const utils = require('./lib/utils')
const insecurity = require('./lib/insecurity')
const models = require('./models')
const datacreator = require('./data/datacreator')
const notifications = require('./data/datacache').notifications
const app = express()
const server = require('http').Server(app)
const io = require('socket.io')(server)
const replace = require('replace')
const appConfiguration = require('./routes/appConfiguration')
const config = require('config')
let firstConnectedSocket = null

global.io = io
errorhandler.title = 'Juice Shop (Express ' + utils.version('express') + ')'

/* Delete old order PDFs */
glob(path.join(__dirname, 'ftp/*.pdf'), (err, files) => {
  if (err) {
    console.log(err)
  } else {
    files.forEach(filename => {
      fs.remove(filename)
    })
  }
})

const showProductReviews = require('./routes/showProductReviews')
const createProductReviews = require('./routes/createProductReviews')
const updateProductReviews = require('./routes/updateProductReviews')

/* Bludgeon solution for possible CORS problems: Allow everything! */
app.options('*', cors())
app.use(cors())

/* Security middleware */
app.use(helmet.noSniff())
app.use(helmet.frameguard())
// app.use(helmet.xssFilter()); // = no protection from persisted XSS via RESTful API

/* Remove duplicate slashes from URL which allowed bypassing subsequent filters */
app.use((req, res, next) => {
  req.url = req.url.replace(/[/]+/g, '/')
  next()
})

/* Favicon */
let icon = 'favicon_v2.ico'
if (config.get('application.favicon')) {
  icon = config.get('application.favicon')
  if (utils.startsWith(icon, 'http')) {
    const iconPath = icon
    icon = decodeURIComponent(icon.substring(icon.lastIndexOf('/') + 1))
    utils.downloadToFile(iconPath, 'app/public/' + icon)
  }
}
app.use(favicon(path.join(__dirname, 'app/public/' + icon)))

/* Checks for solved challenges */
app.use('/public/images/tracking', verify.accessControlChallenges())
app.use('/public/images/products', verify.accessControlChallenges())
app.use('/i18n', verify.accessControlChallenges())

/* /ftp directory browsing and file download */
app.use('/ftp', serveIndex('ftp', { 'icons': true }))
app.use('/ftp/:file', fileServer())

/* /encryptionkeys directory browsing */
app.use('/encryptionkeys', serveIndex('encryptionkeys', { 'icons': true, 'view': 'details' }))
app.use('/encryptionkeys/:file', keyServer())

app.use(express.static(applicationRoot + '/app'))
app.use(cookieParser('kekse'))
app.use(bodyParser.json())

/* HTTP request logging */
app.use(morgan('dev'))

/* Authorization */
/* Baskets: Unauthorized users are not allowed to access baskets */
app.use('/rest/basket', insecurity.isAuthorized())
/* BasketItems: API only accessible for authenticated users */
app.use('/api/BasketItems', insecurity.isAuthorized())
app.use('/api/BasketItems/:id', insecurity.isAuthorized())
/* Feedbacks: GET allowed for feedback carousel, POST allowed in order to provide feedback without being logged in */
app.use('/api/Feedbacks/:id', insecurity.isAuthorized())
/* Users: Only POST is allowed in order to register a new uer */
app.get('/api/Users', insecurity.isAuthorized())
app.route('/api/Users/:id')
  .get(insecurity.isAuthorized())
  .put(insecurity.denyAll()) // Updating users is forbidden to make the password change challenge harder
  .delete(insecurity.denyAll()) // Deleting users is forbidden entirely to keep login challenges solvable
/* Products: Only GET is allowed in order to view products */
app.post('/api/Products', insecurity.isAuthorized())
// app.put('/api/Products/:id', insecurity.isAuthorized()); // = missing function-level access control vulnerability
app.delete('/api/Products/:id', insecurity.denyAll()) // Deleting products is forbidden entirely to keep the O-Saft url-change challenge solvable
/* Challenges: GET list of challenges allowed. Everything else forbidden independent of authorization (hence the random secret) */
app.post('/api/Challenges', insecurity.denyAll())
app.use('/api/Challenges/:id', insecurity.denyAll())
/* Complaints: POST and GET allowed when logged in only */
app.get('/api/Complaints', insecurity.isAuthorized())
app.post('/api/Complaints', insecurity.isAuthorized())
app.use('/api/Complaints/:id', insecurity.denyAll())
/* Recycles: POST and GET allowed when logged in only */
app.get('/api/Recycles', insecurity.isAuthorized())
app.post('/api/Recycles', insecurity.isAuthorized())
app.use('/api/Recycles/:id', insecurity.denyAll())
/* SecurityQuestions: Only GET list of questions allowed. */
app.post('/api/SecurityQuestions', insecurity.denyAll())
app.use('/api/SecurityQuestions/:id', insecurity.denyAll())
/* SecurityAnswers: Only POST of answer allowed. */
app.get('/api/SecurityAnswers', insecurity.denyAll())
app.use('/api/SecurityAnswers/:id', insecurity.denyAll())
/* REST API */
app.use('/rest/user/authentication-details', insecurity.isAuthorized())
app.use('/rest/basket/:id', insecurity.isAuthorized())
app.use('/rest/basket/:id/order', insecurity.isAuthorized())

/* Challenge evaluation before sequelize-restful takes over */
app.post('/api/Feedbacks', verify.forgedFeedbackChallenge())

/* Verifying DB related challenges can be postponed until the next request for challenges is coming via sequelize-restful */
app.use(verify.databaseRelatedChallenges())

// routes for the NoSql parts of the application
app.get('/rest/product/:id/reviews', showProductReviews())
app.put('/rest/product/:id/reviews', createProductReviews())
app.patch('/rest/product/reviews', insecurity.isAuthorized(), updateProductReviews())

/* Sequelize Restful APIs */
app.use(restful(models.sequelize, {
  endpoint: '/api',
  allowed: ['Users', 'Products', 'Feedbacks', 'BasketItems', 'Challenges', 'Complaints', 'Recycles', 'SecurityQuestions', 'SecurityAnswers']
}))
/* Custom Restful API */
app.post('/rest/user/login', login())
app.get('/rest/user/change-password', changePassword())
app.post('/rest/user/reset-password', resetPassword())
app.get('/rest/user/security-question', securityQuestion())
app.get('/rest/user/whoami', currentUser())
app.get('/rest/user/authentication-details', authenticatedUsers())
app.get('/rest/product/search', search())
app.get('/rest/basket/:id', basket())
app.post('/rest/basket/:id/checkout', order())
app.put('/rest/basket/:id/coupon/:coupon', coupon())
app.get('/rest/admin/application-version', appVersion())
app.get('/rest/admin/application-configuration', appConfiguration())
app.get('/rest/repeat-notification', repeatNotification())
app.get('/rest/continue-code', continueCode())
app.put('/rest/continue-code/apply/:continueCode', restoreProgress())
app.get('/rest/admin/application-version', appVersion())
app.get('/redirect', redirect())
/* File Upload */
app.post('/file-upload', upload.single('file'), fileUpload())
/* File Serving */
app.get('/the/devs/are/so/funny/they/hid/an/easter/egg/within/the/easter/egg', easterEgg())
app.get('/this/page/is/hidden/behind/an/incredibly/high/paywall/that/could/only/be/unlocked/by/sending/1btc/to/us', premiumReward())
app.use(angular())
/* Error Handling */
app.use(verify.errorHandlingChallenge())
app.use(errorhandler())

exports.start = function (readyCallback) {
  function registerWebsocketEvents () {
    io.on('connection', socket => {
      // notify only first client to connect about server start
      if (firstConnectedSocket === null) {
        socket.emit('server started')
        firstConnectedSocket = socket.id
      }

      // send all outstanding notifications on (re)connect
      notifications.forEach(notification => {
        socket.emit('challenge solved', notification)
      })

      socket.on('notification received', data => {
        const i = notifications.findIndex(element => element.flag === data)
        if (i > -1) {
          notifications.splice(i, 1)
        }
      })
    })
  }

  function populateIndexTemplate () {
    fs.copy('app/index.template.html', 'app/index.html', { overwrite: true }, () => {
      if (config.get('application.logo')) {
        let logo = config.get('application.logo')
        if (utils.startsWith(logo, 'http')) {
          const logoPath = logo
          logo = decodeURIComponent(logo.substring(logo.lastIndexOf('/') + 1))
          utils.downloadToFile(logoPath, 'app/public/images/' + logo)
        }
        const logoImageTag = '<img class="navbar-brand navbar-logo" src="/public/images/' + logo + '">'
        replace({
          regex: /<img class="navbar-brand navbar-logo"(.*?)>/,
          replacement: logoImageTag,
          paths: ['app/index.html'],
          recursive: false,
          silent: true
        })
      }
      if (config.get('application.theme')) {
        const themeCss = 'bower_components/bootswatch/' + config.get('application.theme') + '/bootstrap.min.css'
        replace({
          regex: /bower_components\/bootswatch\/.*\/bootstrap\.min\.css/,
          replacement: themeCss,
          paths: ['app/index.html'],
          recursive: false,
          silent: true
        })
      }
    })
  }

  if (!this.server) {
    models.sequelize.drop()
    models.sequelize.sync().success(function () {
      datacreator()
      this.server = server.listen(process.env.PORT || config.get('server.port'), () => {
        console.log(colors.yellow('Server listening on port %d'), config.get('server.port'))
        registerWebsocketEvents()
        if (readyCallback) {
          readyCallback()
        }
      })
    })
    populateIndexTemplate()
  }
}

exports.close = function (exitCode) {
  if (this.server) {
    this.server.close(exitCode)
  } else {
    process.exit(exitCode)
  }
}
