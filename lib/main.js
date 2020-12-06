import AWS from 'aws-sdk';
import {credential} from '../aws-credential';

const audioUtils        = require('./audioUtils');  // for encoding audio data as PCM
const crypto            = require('crypto'); // tot sign our pre-signed URL
const v4                = require('./aws-signature-v4'); // to generate our pre-signed URL
const marshaller        = require("@aws-sdk/eventstream-marshaller"); // for converting binary event stream messages to and from JSON
const util_utf8_node    = require("@aws-sdk/util-utf8-node"); // utilities for encoding and decoding UTF8
const mic               = require('microphone-stream'); // collect microphone input as a stream of raw bytes

// our converter between binary event streams messages and JSON
const eventStreamMarshaller = new marshaller.EventStreamMarshaller(util_utf8_node.toUtf8, util_utf8_node.fromUtf8);

// our global variables for managing state
let languageCode;
let region;
let sampleRate;
let inputSampleRate;
let transcription = "";
let socket;
let micStream;
let socketError = false;
let transcribeException = false;

// check to see if the browser allows mic access
if (!window.navigator.mediaDevices.getUserMedia) {
    // Use our helper method to show an error on the page
    showError('We support the latest versions of Chrome, Firefox, Safari, and Edge. Update your browser and try your request again.');

    // maintain enabled/distabled state for the start and stop buttons
    toggleStartStop();
}

$('#start-button').click(function () {
    $('#error').hide(); // hide any existing errors
    toggleStartStop(true); // disable start and enable stop button

    // set the language and region from the dropdowns
    setLanguage();
    setRegion();

    // first we get the microphone input from the browser (as a promise)...
    window.navigator.mediaDevices.getUserMedia({
            video: false,
            audio: true
        })
        // ...then we convert the mic stream to binary event stream messages when the promise resolves 
        .then(streamAudioToWebSocket) 
        .catch(function (error) {
            showError('There was an error streaming your audio to Amazon Transcribe. Please try again.');
            toggleStartStop();
        });
});

let streamAudioToWebSocket = function (userMediaStream) {
    //let's get the mic input from the browser, via the microphone-stream module
    micStream = new mic();

    micStream.on("format", function(data) {
        inputSampleRate = data.sampleRate;
    });

    micStream.setStream(userMediaStream);

    // Pre-signed URLs are a way to authenticate a request (or WebSocket connection, in this case)
    // via Query Parameters. Learn more: https://docs.aws.amazon.com/AmazonS3/latest/API/sigv4-query-string-auth.html
    let url = createPresignedUrl();

    //open up our WebSocket connection
    socket = new WebSocket(url);
    socket.binaryType = "arraybuffer";

    let sampleRate = 0;

    // when we get audio data from the mic, send it to the WebSocket if possible
    socket.onopen = function() {
        micStream.on('data', function(rawAudioChunk) {
            // the audio stream is raw audio bytes. Transcribe expects PCM with additional metadata, encoded as binary
            let binary = convertAudioToBinaryMessage(rawAudioChunk);

            if (socket.readyState === socket.OPEN)
                socket.send(binary);
        }
    )};

    // handle messages, errors, and close events
    wireSocketEvents();
}

function setLanguage() {
    languageCode = "en-US";
    if (languageCode == "en-US" || languageCode == "es-US")
        // sampleRate = 44100;
        sampleRate = 16000;
    else
        sampleRate = 8000;
}

function setRegion() {
    region = $('#region').find(':selected').val();
}

function wireSocketEvents() {
    // handle inbound messages from Amazon Transcribe
    socket.onmessage = function (message) {
        
        //convert the binary event stream message to JSON
        let messageWrapper = eventStreamMarshaller.unmarshall(Buffer(message.data));
        let messageBody = JSON.parse(String.fromCharCode.apply(String, messageWrapper.body));
        
        if (messageWrapper.headers[":message-type"].value === "event") {
            handleEventStreamMessage(messageBody);
        }
        else {
            transcribeException = true;
            showError(messageBody.Message);
            toggleStartStop();
        }
    };

    socket.onerror = function () {
        socketError = true;
        showError('WebSocket connection error. Try again.');
        toggleStartStop();
    };
    
    socket.onclose = function (closeEvent) {
        micStream.stop();
        
        // the close event immediately follows the error event; only handle one.
        if (!socketError && !transcribeException) {
            if (closeEvent.code != 1000) {
                showError('</i><strong>Streaming Exception</strong><br>' + closeEvent.reason);
            }
            toggleStartStop();
        }
    };
}

let handleEventStreamMessage = function (messageJson) {
    let results = messageJson.Transcript.Results;

    

    if (results.length > 0) {
        if (results[0].Alternatives.length > 0) {
            let transcript = results[0].Alternatives[0].Transcript;

            // fix encoding for accented characters
            transcript = decodeURIComponent(escape(transcript));

            // update the textarea with the latest result
            $('#comprehend-transcript').text(transcription + transcript + "\n");

            // if this transcript segment is final, add it to the overall transcription
            if (!results[0].IsPartial) {
                // var nei = JSON.parse(messageJson);
                console.log(messageJson,'the json obj');
                let speaker = messageJson.Transcript.Results[0].Alternatives[0].Items[0].Speaker;
                console.log('speaker: '+speaker);
                
                //scroll the textarea down
                $('#comprehend-transcript').scrollTop($('#comprehend-transcript')[0].scrollHeight);

                transcription += transcript + "\n";
            }
        }
    }
}

let closeSocket = function () {
    if (socket.readyState === socket.OPEN) {
        micStream.stop();

        // Send an empty frame so that Transcribe initiates a closure of the WebSocket after submitting all transcripts
        let emptyMessage = getAudioEventMessage(Buffer.from(new Buffer([])));
        let emptyBuffer = eventStreamMarshaller.marshall(emptyMessage);
        socket.send(emptyBuffer);
    }
}


$('#stop-button').click(function () {
    closeSocket();
    toggleStartStop();
});

$('#reset-button').click(function (){
    $('#comprehend-transcript').text('');
    transcription = '';
});
$('#explain-button').click(
    function() {
        $.ajax({
            type: "get",
            url: "https://wsearch.nlm.nih.gov/ws/query?db=healthTopics&term=%22diabetes+medicines%22+OR+%22diabetes+drugs%22",
            dataType: "xml",
            success: function(data) {
                /* handle data here */
                $("#show_table").html(data);
            },
            error: function(xhr, status) {
                /* handle error here */
                $("#show_table").html(status);
            }
        });
    // let x = new XMLHttpRequest();
    // x.open("GET", "http://feed.example/", true);
    // x.onreadystatechange = function () {
    // if (x.readyState == 4 && x.status == 200)
    // {
    //     var doc = x.responseXML;
    //     // …
    // }
    // };
    // x.send(null);
});
// for comprehend
const comprehendMedical = new AWS.ComprehendMedical(credential);

function detectEntity(text) {
    console.log('start!!!!!!!!!!!');
    if(text === undefined || text.replace(/\s/g,"") === ""){
        // Transcript is empty, nothing to detect, also CompMed would through exception
        return [];
    }
    //clients can be shared by different commands
    const params = {
        Text: text,
    };

    console.log(`Send text ${text} to comprehend medical`);
    return new Promise((resolve, reject) => {
        comprehendMedical.detectEntitiesV2(params, function (err, data) {
            if (err) {
                console.log(err, err.stack); // an error occurred
                reject(err);
            }
            else     {
                // console.log(data);           // successful response
                resolve(data);
            }
        })
    });
}
$('#comprehend-button').click(function (){
    transcription = $('#comprehend-transcript').text();
    //transcription = 'The liver attachments to the adrenal kidney or divided than the liver was reflected superior early.The liver attachments to the adrenal kidney or divided than the liver was reflected superior early.The liver attachments to the adrenal kidney or divided than the liver was reflected superior early.The liver attachments to the adrenal kidney or divided than the liver was reflected superior early.The liver attachments to the adrenal kidney or divided than the liver was reflected superior early.The liver attachments to the adrenal kidney or divided than the liver was reflected superior early.The liver attachments to the adrenal kidney or divided than the liver was reflected superior early.';

    var promise = detectEntity(transcription);
    var wordList = [];

    promise.then(function(result){
        console.log("data: ",result);
        var len = result.Entities.length;
        console.log('len: '+len);
        for (var i =0; i<len; i++){
            var term = result.Entities[i].Text
            console.log("element: "+term);
            highlight(term);
            wordList.push(term);
        }
    }, function(err){
        console.log("err: "+err);
    });
    // console.log("text info: "+transcription);
    // console.log("data state: ", data.then());
    // console.log("data : ", data.Promise.PromiseResult.Entities);
    // console.log("first : ", data.Promise.PromiseResult.Entities[0].Text);
});


function highlight(text) {
    var inputText = document.getElementById("comprehend-transcript");
    var innerHTML = inputText.innerHTML;
    var index = innerHTML.indexOf(text);

    if (index >= 0) { 
        innerHTML = innerHTML.substring(0,index) + "<span class='highlight'>" + innerHTML.substring(index,index+text.length) + "</span>" + innerHTML.substring(index + text.length);
        inputText.innerHTML = innerHTML;
    }
}




function toggleStartStop(disableStart = false) {
    $('#start-button').prop('disabled', disableStart);
    $('#stop-button').attr("disabled", !disableStart);
}

function showError(message) {
    $('#error').html('<i class="fa fa-times-circle"></i> ' + message);
    $('#error').show();
}

function convertAudioToBinaryMessage(audioChunk) {
    let raw = mic.toRaw(audioChunk);

    if (raw == null)
        return;

    // downsample and convert the raw audio bytes to PCM
    let downsampledBuffer = audioUtils.downsampleBuffer(raw, inputSampleRate, sampleRate);
    let pcmEncodedBuffer = audioUtils.pcmEncode(downsampledBuffer);

    // add the right JSON headers and structure to the message
    let audioEventMessage = getAudioEventMessage(Buffer.from(pcmEncodedBuffer));

    //convert the JSON object + headers into a binary event stream message
    let binary = eventStreamMarshaller.marshall(audioEventMessage);

    return binary;
}

function getAudioEventMessage(buffer) {
    // wrap the audio data in a JSON envelope
    return {
        headers: {
            ':message-type': {
                type: 'string',
                value: 'event'
            },
            ':event-type': {
                type: 'string',
                value: 'AudioEvent'
            }
        },
        body: buffer
    };
}

function createPresignedUrl() {
    let endpoint = "transcribestreaming." + region + ".amazonaws.com:8443";

    // get a preauthenticated URL that we can use to establish our WebSocket
    return v4.createPresignedURL(
        'GET',
        endpoint,
        '/medical-stream-transcription-websocket',
        'transcribe',
        crypto.createHash('sha256').update('', 'utf8').digest('hex'), {
            // 'key': $('#access_id').val(),
            // 'secret': $('#secret_key').val(),
            'key': credential.accessKeyId,
            'secret': credential.secretAccessKey,
            // 'sessionToken': $('#session_token').val(),
            'sessionToken': "",
            'protocol': 'wss',
            'expires': 15,
            'region': region,
            'query': "language-code=" + languageCode + "&media-encoding=pcm&sample-rate=" + sampleRate
        }
    );
}


