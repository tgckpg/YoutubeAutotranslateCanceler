// ==UserScript==
// @name         Youtube Auto-translate Canceler
// @namespace    https://github.com/tgckpg/YoutubeAutotranslateCanceler/
// @version      0.5
// @description  Remove auto-translated youtube titles
// @author       Pierre Couy
// @match        https://www.youtube.com/*
// @grant        GM.setValue
// @grant        GM.getValue
// @grant        GM.deleteValue
// ==/UserScript==

(async () => {
    'use strict';
    /*
    Get a YouTube Data v3 API key from https://console.developers.google.com/apis/library/youtube.googleapis.com?q=YoutubeData
    */
    var NO_API_KEY = false;
    var api_key_awaited = await GM.getValue("api_key");
    if(api_key_awaited === undefined || api_key_awaited === null || api_key_awaited === ""){
        await GM.setValue("api_key", prompt("Enter your API key. Go to https://developers.google.com/youtube/v3/getting-started to know how to obtain an API key, then go to https://console.developers.google.com/apis/api/youtube.googleapis.com/ in order to enable Youtube Data API for your key."));
    }

    api_key_awaited = await GM.getValue("api_key");
    if(api_key_awaited === undefined || api_key_awaited === null || api_key_awaited === ""){
        NO_API_KEY = true; // Resets after page reload, still allows local title to be replaced
        console.log("NO API KEY PRESENT");
    }
    const API_KEY = await GM.getValue("api_key");
    var API_KEY_VALID = false;
		console.log(API_KEY);

    var url_template = "https://www.googleapis.com/youtube/v3/videos?part=snippet&id={IDs}&key=" + API_KEY;

    var cachedTitles = {} // Dictionary(id, title): Cache of API fetches, survives only Youtube Autoplay

    var currentLocation; // String: Current page URL
    var changedDescription; // Bool: Changed description
    var alreadyChanged; // List(string): Links already changed
    var dataCache = {};

    var _runStates = {};
    var _runOnce = function( txt, f )
    {
        if( txt in _runStates )
            return;
        _runStates[ txt ] = true;
        f( txt );
    };

    var getVideoID = function( a )
    {
        if(!( typeof a === "string" || a instanceof String ))
        {
            while( a.tagName != "A" )
            {
                a = a.parentNode;
            }
            a = a.href;
        }
        a = a.split('v=')[1];
        return a.split('&')[0];
    };

    var resetChanged = function()
    {
        console.log(" --- Page Change detected! --- ");
        currentLocation = window.location.href;
        changedDescription = false;
        alreadyChanged = [];
        // dataCache = {};
        _runStates = {};
    };
    resetChanged();

    var ignoreEl = function( el )
    {
        if( el.querySelector( "yt-thumbnail-view-model" )
            || el.id == "thumbnail"
        ) return true;

        return false;
    };

    var processData = function( IDs, links, mainVidID, data )
    {
        if(data.kind == "youtube#videoListResponse")
        {
            API_KEY_VALID = true;

            data = data.items;

            if (mainVidID != "")
            { // Replace Main Video Description
                var videoDescription = data[0].snippet.description;

                var collapsedDesc = document.querySelector( "[id=snippet] yt-attributed-string" );
                if( collapsedDesc )
                {
                    var nLines = collapsedDesc.innerText.split( "\n" ).length;
                    _runOnce( videoDescription.split( "\n" ).slice( 0, nLines ).join( "\n" ), (t) => { collapsedDesc.innerText = t; } );
                }

				var expandedDesc = document.querySelector( "[id=expanded] yt-attributed-string" );
                if( expandedDesc && !expandedDesc.hidden )
                {
                    _runOnce( videoDescription, (t) => { expandedDesc.innerText = t; } );
                }
            }

            // Create dictionary for all IDs and their original titles
            data = data.forEach( v => {
                cachedTitles[v.id] = v.snippet.title;
            } );

            // Change all previously found link elements
            for( var i=0 ; i < links.length ; i++ )
            {
                var linkEl = links[i];

                if( ignoreEl( linkEl ) )
                    continue;

                var curID = getVideoID( linkEl );
                if (curID !== IDs[i])
                { // Can happen when Youtube was still loading when script was invoked
                    console.log ("YouTube was too slow again...");
                    changedDescription = false; // Might not have been loaded aswell - fixes rare errors
                }

                if (cachedTitles[curID] !== undefined)
                {
                    var originalTitle = cachedTitles[curID];
                    var pageTitle = links[i].innerText.trim();
                    if( pageTitle && pageTitle != originalTitle.replace(/\s{2,}/g, ' ') )
                    {
                        console.log ("'" + pageTitle + "' --> '" + originalTitle + "'");
                        links[i].innerText = originalTitle;
                    }
                    alreadyChanged.push(links[i]);
                }
            }

            // MAIN TITLE
            if (window.location.href.includes("/watch") )
            {
                pageTitle = document.querySelector( "[id=title] yt-formatted-string" );
                if ( pageTitle )
                {
            		_runOnce( cachedTitles[ getVideoID( window.location.href ) ], ( t ) => { document.title = pageTitle.innerText = t; } );
                }
            }
        }
        else
        {
            console.log("API Request Failed!");
            console.log(data);

            // This ensures that occasional fails don't stall the script
            // But if the first query is a fail then it won't try repeatedly
            NO_API_KEY = !API_KEY_VALID;
            if (NO_API_KEY) {
                GM_setValue('api_key', '');
                console.log("API Key Fail! Please Reload!");
            }
        }
    };

    var changeTitles = function()
    {
        if(currentLocation !== window.location.href)
            resetChanged();

        if (NO_API_KEY)
            return;

        var APIcallIDs;

        // REFERENCED VIDEO TITLES - find video link elements in the page that have not yet been changed
        var links = Array.prototype.slice.call(document.querySelectorAll("a")).filter( a => {
            return ~a.href.indexOf( "/watch?v=" ) && alreadyChanged.indexOf(a) == -1;
        } );
        var spans = [];

         // MAIN VIDEO DESCRIPTION - request to load original video description
        var mainVidID = "";
        if (!changedDescription && window.location.href.includes ("/watch"))
        {
            mainVidID = window.location.href.split('v=')[1].split('&')[0];
        }

        if(mainVidID != "" || links.length > 0)
        { // Initiate API request
            // Get all videoIDs to put in the API request
            var IDs = links.map( a => getVideoID (a));
            var APIFetchIDs = IDs.filter(id => cachedTitles[id] === undefined).slice(0,30);
            var requestUrl = url_template.replace("{IDs}", (mainVidID != ""? (mainVidID + ",") : "") + APIFetchIDs.join(','));

            if( dataCache[ requestUrl ] )
            {
                processData( IDs, links, mainVidID, dataCache[ requestUrl ] );
                return;
            }

            // Issue API request
            var xhr = new XMLHttpRequest();
            xhr.onreadystatechange = function ()
            {
                if (xhr.readyState === 4)
                { // Success
                    var data = JSON.parse(xhr.responseText);
                    dataCache[ requestUrl ] = data;
                    processData( IDs, links, mainVidID, data );
                }
            };
            xhr.open('GET', requestUrl);
            xhr.send();
        }
    };

    // Execute every seconds in case new content has been added to the page
    // DOM listener would be good if it was not for the fact that Youtube changes its DOM frequently
    setInterval(changeTitles, 1000);
})();
