var XMPP = require('node-xmpp');
var Connect = require('connect');
var Formidable = require('formidable');
var Crypto = require('crypto');
var twitter = require('twitter');


/** Args parsing **/

if (process.argv.length != 5) {
    console.error("Parameters: <my-jid> <my-password> <full-muc-jid>");
    process.exit(1);
}
var jid = process.argv[2],
pass = process.argv[3],
muc_jid = process.argv[4],
muc_room_jid = (new XMPP.JID(muc_jid)).bare().toString();

/** XMPP stuff **/

var NS_MUC = 'http://jabber.org/protocol/muc';
var NS_VCARD = 'vcard-temp';
var NS_VCARD_UPDATE = 'vcard-temp:x:update';
var client = null;
var clientOnline = false;
function setupClient() {
    clientOnline = false;
    client = new XMPP.Client({ jid: jid,
			       password: pass
			     });
    client.on('online', function() {
	clientOnline = true;
	client.send(makePresence());
    });
    client.on('end', function() {
	if (clientOnline) {
	    clientOnline = false;
	    // we were online, we can retry
	    process.nextTick(setupClient);
	} else {
	    // we didn't get beyond auth, die
	    process.exit(1);
	}
    });
    client.on('error', function() {
           process.exit(1);
    });
    client.on('rawStanza', console.log);
    // Auto-subscribe
    client.on('stanza', function(stanza) {
	if (stanza.name === 'presence' && stanza.attrs.type == 'subscribe')
	    client.send(new XMPP.Element('presence',
					 { to: stanza.attrs.from,
					   type: 'subscribed'
					 }));
        else if (stanza.name === 'message' &&
		 stanza.attrs.type === 'groupchat') {
	    var text = stanza.getChildText('body') + "";
	    var m;
	    if ((m = text.match(/^tweet (.+)$/))) {
		tweet(m[1], function(error) {
		    var reply = new XMPP.Element('message', {
			to: new XMPP.JID(stanza.attrs.from).bare().toString(),
			type: 'groupchat'
		    }).c('body');
		    if (error)
			reply.t("Fail whale: " + (error.message || error.stack || (error + "")));
		    else
			reply.t(TWEET_SUCCESS[Math.floor(TWEET_SUCCESS.length * Math.random())]);
		});
	    }
	}
    });
}

setupClient();

function makePresence() {
    return new XMPP.Element('presence',
			    { to: muc_jid
			    }).
	c('status').t('I obey to machines').up().
	c('x', { xmlns: NS_MUC }).up();
}

function relayMessage(text) {
    if (clientOnline)
	client.send(new XMPP.Element('message',
				     { to: muc_room_jid,
				       type: 'groupchat'
				     }).
		    c('body').t(text)
		   );
    else
	throw 'Not online yet';
}

function setAvatar(photo, type) {
    var photo64 = photo.toString('base64');
    var photo_sha1 = Crypto.createHash('sha1').
	update(photo).digest('hex');

    client.send(new XMPP.Element('iq',
				 { type: 'set' }).
		c('vCard', { xmlns: NS_VCARD }).
		c('NICKNAME').t('MUC Bot').up().
		c('PHOTO').
		c('BINVAL').t(photo64).up().
		c('TYPE').t(type)
	       );
    var presence = makePresence().
	c('x', { xmlns: NS_VCARD_UPDATE }).
	c('photo').t(photo_sha1);
    client.send(presence);

    return presence.root().toString() + "\n";
}

/** Twitter crap **/

var twit = new twitter({
    consumer_key: '',
    consumer_secret: '',
    access_token_key: '',
    access_token_secret: ''
});
twit.stream('user', {}, function(stream) {
    stream.on('data', function(data) {
        console.log("user data", data);
    });
});

function tweet(text, cb) {
    twit.updateStatus(text, function(error, data) {
	console.log("updateStatus cb", error, data);
	cb(error);
    });
}

var TWEET_SUCCESS = [
    "You just spammed on Social Media",
    "A big corporation says: Thank you for your content!",
    "Successfully posted to Twtr",
    "Successfully avoided fail whale",
    "Sent",
    "Ok",
    "aber Facebook nicht vergessen",
    "Your communication is now public to anyone",
    "Tweeted",
    "Twat",
    "Piep",
    "und identi.ca?",
    "und wieder ein follower weniger",
    "Result code: 0",
    "Success",
    "No error detected",
    "Went through",
    "the internet is dying",
    "everyone is really curious on what you for breakfast",
    "✔", "👍"
];

/** Web stuff **/

function handlePartInBuffer(part) {
    var form = this;

    var bufs = [], bufsLen = 0;
    part.on('data', function(data) {
	bufs.push(data);
	bufsLen += data.length;
    });
    part.on('end', function() {
	var data = new Buffer(bufsLen)
	var offset = 0;
	for(var i = 0; i < bufs.length; i++) {
	    bufs[i].copy(data, offset, 0);
	    offset += bufs[i].length;
	}
	
	form.emit('file', part.name,
		  { filename: part.filename,
		    mime: part.mime,
		    data: data
		  });
    });
}

Connect.createServer(
    Connect.logger(),
    Connect.bodyParser(),
    Connect.router(function(app) {
	// curl --data-urlencode "text=Hello, World" http://localhost:4000/msg
	app.post('/msg', function(req, res) {
	    var text;
	    if (req.body && (text = req.body.text)) {
		relayMessage(text);
		res.writeHead(200, {});
		res.end('Sent');
	    } else {
		res.writeHead(400, {});
		res.end('Only application/x-www-form-urlencoded and application/json are permitted. ' +
			'There must be a `text\' field');
	    }
	});
	// curl -F photo=@avatar.jpg http://localhost:4000/avatar
	app.post('/avatar', function(req, res) {
	    var form = new Formidable.IncomingForm();
	    form.encoding = 'binary';
	    form.bytesExpected = 16 * 1024;
	    form.handlePart = handlePartInBuffer;
	    form.parse(req, function(err, fields, forms) {
		var photo;
		if (!err && (photo = forms.photo)) {
		    var info = setAvatar(photo.data, photo.mime);
		    res.writeHead(200, { 'Content-Type': 'application/xml+xmpp' });
		    res.end(info);
		} else {
		    res.writeHead(500, {});
		    res.end(err.message);
		}
	    });
	});
    }),
    Connect.errorHandler({ dumpExceptions: true, showStack: true })
).listen(4000, '::');
