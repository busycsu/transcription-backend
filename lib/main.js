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

// include domParser
const DomParser = require('dom-parser');

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
            // $('#comprehend-transcript').text(transcription + transcript + "\n");
            $('#transcript').text(transcription + transcript + "\n");
            // if this transcript segment is final, add it to the overall transcription
            if (!results[0].IsPartial) {
                // var nei = JSON.parse(messageJson);
                console.log(messageJson,'the json obj');
                let speaker = messageJson.Transcript.Results[0].Alternatives[0].Items[0].Speaker;
                console.log('speaker: '+speaker);
                
                //scroll the textarea down
                // $('#comprehend-transcript').scrollTop($('#comprehend-transcript')[0].scrollHeight);
                $('#transcript').scrollTop($('#transcript')[0].scrollHeight);


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
    document.getElementById("transcript").innerHTML = "<div id='comprehend-transcript' style='opacity: 30%;padding: 3px 3px;'>Press Start and speak into your mic</div>"
    // $('#comprehend-transcript').text('Press Start and speak into your mic');
    transcription = '';
});
function explainFunc(btnName){
    console.log("Button click");
    
    medlineCall(btnName);
}

function trimWord(word){
    return word.split('.').join("").split(',').join("");
}

let dic = {};

let GLOBAL_WORD_LIST = [];
// GLOBAL_WORD_LIST.push('liver');
// GLOBAL_WORD_LIST.push('renal vein');
// dic[GLOBAL_WORD_LIST[0]]="";
// dic[GLOBAL_WORD_LIST[1]]="";


function splitByTerms(terms){
    
    var ans = []
    
    for (var i=0; i<terms.length; i++){
       
    
        var trimedWord = trimWord(terms[i]).toLowerCase();
        if(trimedWord in dic){
            ans.push(terms[i]);
            continue;
        }
        if(i<terms.length-1){
            console.log("splitByTerms terms i:", terms[i]);
            console.log("splitByTerms terms i+1:", terms[i+1]);

            var tmp = trimWord(terms[i+1]).toLowerCase();
            var tmpTerm = trimedWord+' '+tmp;
            console.log("splitByTerms tmpTerm:", tmpTerm);
            if(tmpTerm in dic){
                var realTerm = terms[i]+' '+terms[i+1];
                ans.push(realTerm);
                i = i+1;
                continue;
            }else{
                ans.push(terms[i]);
            }
        }
    }
    for (var i=0; i<ans.length; i++){
        console.log("ans",i,ans[i]);
    }
    return ans;
}

function generateHtmlCode(text){
    console.log("text:", text)
    // var trimText = text.split('.').join("").split(',').join("");
    // console.log("trim text", trimText)
    var numOfBtn = 0
    // var l = text.split(" ");
    var l = splitByTerms(text.split(" "));
    console.log("list length:",l.length)
    var ans = "<span>";
    console.log("html 1: ", ans)
    
    
    var medList = [];
    for(var i=0; i<l.length; i++){
        console.log("element:", l[i]);
        console.log("html 2: ", ans)
        console.log("in dic:", l[i] in dic)
        if( !(trimWord(l[i])in dic)){
            tmp = l[i] + " "
            ans += tmp;
        }else{
            var btnID = "explain-btn"+numOfBtn
            var tmp = ' </span><button id='+'"'+btnID+'"'+'>'+l[i]+'</button><span> ';
            var medTerm = trimWord(l[i]);
            medList.push(medTerm);
            ans += tmp;
            numOfBtn += 1;
        }
    }
    ans += "</span>"
    console.log("html: ", ans)
    return [ans, numOfBtn, medList];
}

function medlineCall (term){
    const https = require('https')
    
    var url = 'https://wsearch.nlm.nih.gov/ws/query?db=healthTopics&term='+term;
    console.log(url)
    var req = https.get(url, function(res) {
        // save the data
        var text = '';
        res.on('data', function(chunk) {
            text += chunk;
        });
      
        res.on('end', function() {
            var parser = new DomParser();
            var xmlDoc = parser.parseFromString(text, "text/xml");

            var doc = [];
            var unParsedFullSummary = xmlDoc.getElementsByTagName("document")[0].getElementsByName("FullSummary")[0].textContent;
            
            var ParsedFullSummary = parseExplanation(unParsedFullSummary);        

            doc.push(ParsedFullSummary);
            // console.log("summary",doc[0]);
            var summary = doc[0];
            var htmlCode = '<div>'+summary+'</div>';
            // var htmlCode = ParsedFullSummary;
            console.log(typeof(ParsedFullSummary));
            console.log("html",htmlCode);
            document.getElementById("term_explanation").innerHTML = htmlCode;
            
  
        });
        // or you can pipe the data to a parser
        // res.pipe(dest);
      });
      
      req.on('error', function(err) {
        // debug error
      });
}


$('#explain-button').click(
    function() {
        var text = $('#transcript').text();
        // var text = "The liver attachments to the adrenal kidney or divided than the liver was reflected superiorly. \
        //             Vena cava was identified. The main renal vein was identified. "
        var [htmlCode, numOfBtn, medList] = generateHtmlCode(text);
        document.getElementById("transcript").innerHTML=(htmlCode);
        for(let btn=0; btn<numOfBtn; btn++){
            document.getElementById("explain-btn"+btn).onclick = function(){
                explainFunc(medList[btn]);
            }
        }
        
        
        // $.ajax({
        //     type: "get",
        //     url: "https://wsearch.nlm.nih.gov/ws/query?db=healthTopics&term=%22diabetes+medicines%22+OR+%22diabetes+drugs%22",
        //     dataType: "xml",
        //     success: function(data) {
        //         /* handle data here */
        //         $("#show_table").html(data);
        //     },
        //     error: function(xhr, status) {
        //         /* handle error here */
        //         $("#show_table").html(status);
        //     }
        // });

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
    // transcription = $('#comprehend-transcript').text(); 
    
    $('#transcript').text('The liver attachments to the adrenal kidney or divided than the little was reflected superior early. \
    Vena Cava was identified. The main renal vein was identified.');
    transcription = $('#transcript').text();
    

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
            GLOBAL_WORD_LIST.push(term);
            dic[term] = "";
        }
        for (let comp_i =0; comp_i < len; comp_i++){
            console.log("btn id:",wordList[comp_i].split(" ").join("_"))
            document.getElementById(wordList[comp_i].split(" ").join("_")).onclick = function(){
                explainFunc(wordList[comp_i]);
            }
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
    // var inputText = document.getElementById("comprehend-transcript");
    var inputText = document.getElementById("transcript");
    var innerHTML = inputText.innerHTML;
    var index = innerHTML.indexOf(text);
    let newText = text;
    if(text.indexOf(" ")>0){
        newText = text.split(" ").join("_");
    }
    if (index >= 0) { 
        
        console.log("new text",newText)
        innerHTML = innerHTML.substring(0,index) + "<button id="+"'"+newText+"' class='highlight'>" + innerHTML.substring(index,index+text.length) + "</button>" + innerHTML.substring(index + text.length);
        // innerHTML = "<span>"+innerHTML.substring(0,index) + "</span>" + "<button >" + innerHTML.substring(index,index+text.length) + "</button>" + "<span>"+innerHTML.substring(index + text.length)+"</span>";
        
        console.log("newtext",innerHTML);
        console.log(newText)
        // document.getElementById(newText).onclick = function(){
        //     explainFunc(text);
        // }
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


function parseExplanation(unParsedFullSummary){
    // var startParse = [];
    // var endParse = [];
    // var ParsedFullSummary="";
    // for(var i=0;i<unParsedFullSummary.length-2;i++){
    //     if(unParsedFullSummary[i]=='&' && unParsedFullSummary[i+1]=='l'){
    //         startParse.push(i);
    //     }
    //     if(unParsedFullSummary[i]=='&' && unParsedFullSummary[i+1]=='g'){
    //         endParse.push(i);
    //     }
    // }

    // for(var j=0;j<startParse.length-1;j++){
    //     if(endParse[j]-startParse[j]==6 && j%2==1){ // trying to format li properly, add space every other iteration
    //         ParsedFullSummary +=" ";
    //     }
    //     ParsedFullSummary += unParsedFullSummary.substring(endParse[j]+4,startParse[j+1]);
    // }

    // //console.log(ParsedFullSummary);
    // return ParsedFullSummary;
    var ParsedFullSummary = unParsedFullSummary.split("&lt;").join("<").split("&gt;").join(">")
    
    return ParsedFullSummary;
}
