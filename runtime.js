TWEEG_RUNTIME = (function(){
    return {
        filter: {
            json_encode: function(val) {
                return JSON.stringify(val);
            }
        },

        operator: {
            "matches": function(str, rx) {
                var m = /^\/(.*)\/([igmsy])?$/.exec(rx);
                if (!m) {
                    throw new Error("Invalid regular expression: " + rx);
                }
                return new RegExp(m[1], m[2]).exec(str);
            },
            "starts with": function(str, x) {
                str = String(str);
                x = String(x);
                return str.substr(0, x.length) == x;
            },
            "ends with": function(str, x) {
                str = String(str);
                x = String(x);
                var pos = str.lastIndexOf(x);
                return pos + x.length == str.length;
            },
            "..": function(beg, end) {
                var i;
                if (beg >= end) {
                    for (i = beg, a = []; i <= end; ++i) {
                        a.push(i);
                    }
                } else {
                    for (i = end, a = []; i >= beg; --i) {
                        a.push(i);
                    }
                }
                return a;
            },
            "in": function(thing, data) {
                if (Array.isArray(data) || typeof data == "string") {
                    return data.indexOf(thing) >= 0;
                }
                return Object.prototype.hasOwnProperty.call(data, thing);
            }
        },

        bool: function(val) {
            return !!val;       // XXX: there are some twig particularities here
        },

        make_hash: function(data) {
            for (var i = 0, obj = {}; i < data.length;) {
                obj[data[i++]] = data[i++];
            }
            return obj;
        }
    };
});
