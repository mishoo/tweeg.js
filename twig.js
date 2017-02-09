TWIG = function(){

    "use strict";

    var ALL_OPERATORS = [ "??", "?:", "?", "|", "=" ];

    var UNARY_OPERATORS = make_operators([
        [ "not" ],
        [ "-", "+" ]
    ]);

    var BINARY_OPERATORS = make_operators([
        [ "or" ],
        [ "and" ],
        [ "b-or" ],
        [ "b-xor" ],
        [ "b-and" ],
        [ "==", "!=", "<", ">", ">=", "<=",
          "not in", "in", "matches", "starts with", "ends with" ],
        [ ".." ],
        [ "+", "-" ],
        [ "~" ],
        [ "*", "/", "//", "%" ],
        [ "is", "is not" ],
        [ "**" ],
        [ "??" ]
    ]);

    var RX_WHITESPACE = /^[ \u00a0\n\r\t\f\u000b\u200b\u2000\u2001\u2002\u2003\u2004\u2005\u2006\u2007\u2008\u2009\u200a\u2028\u2029\u202f\u205f\u3000\uFEFF]+/;

    var RX_OPERATOR;

    return {
        parse: parse,
        Lexer: Lexer,
        init: init
    };

    function init() {
        var rx = "^(?:" + ALL_OPERATORS.sort(function(a, b){
            return b.length - a.length;
        }).map(quote_regexp).join("|") + ")";
        RX_OPERATOR = new RegExp(rx);
    }

    function make_operators(a) {
        var precedence = {};
        for (var i = 0; i < a.length; ++i) {
            var b = a[i];
            for (var j = 0; j < b.length; ++j) {
                ALL_OPERATORS.push(b[j]);
                precedence[b[j]] = i + 1;
            }
        }
        return precedence;
    }

    function quote_regexp(string) {
        return string.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    }

    function parse(input) {

    }

    function Lexer(input) {
        input = InputStream(input);
        var current;
        var twig_mode = false;
        var next_tokens = [];
        return {
            next  : next,
            peek  : peek,
            eof   : eof,
            croak : croak
        };

        function is_digit(ch) {
            return /\d/.test(ch);
        }

        function is_punc(ch) {
            return ".,:;(){}[]".indexOf(ch) >= 0;
        }

        function is_id_start(ch) {
            return /^[a-z_]$/i.test(ch); // XXX: unicode? anything else?
        }

        function is_id_char(ch) {
            return is_id_start(ch) || is_digit(ch);
        }

        function read_while(predicate) {
            var str = "";
            while (!input.eof() && predicate(input.peek())) {
                str += input.next();
            }
            return str;
        }

        function skip_whitespace() {
            input.skip(RX_WHITESPACE);
        }

        function read_escaped(end) {
            var escaped = false, str = "";
            input.next();
            while (!input.eof()) {
                var ch = input.next();
                if (escaped) {
                    str += ch;
                    escaped = false;
                } else if (ch == "\\") {
                    escaped = true;
                } else if (ch == end) {
                    break;
                } else {
                    str += ch;
                }
            }
            return str;
        }

        function skip_comment() {
            var m = input.skip(/^.*(-?\#\})/);
            if (!m) {
                croak("Unfinished comment");
            }
            if (m[1].charAt(0) == "-") {
                skip_whitespace();
            }
        }

        function read_expr_token() {
            var ch, m;
            skip_whitespace();
            if ((m = input.skip(/^(?:-?\%\}|-?\}\})/))) {
                twig_mode = false;
                var tmp = m[0];
                if (tmp.charAt(0) == "-") {
                    skip_whitespace();
                    tmp = tmp.substr(1);
                }
                return { type: tmp == "}}" ? "/expr" : "/stat" };
            }
            ch = input.peek();
            if (ch == null) {
                return null;
            }
            if ((m = input.skip(RX_OPERATOR))) {
                return { type: "op", value: m[0] };
            }
            if ((m = input.skip(/^0x([0-9a-fA-F]+)/))) {
                return { type: "num", value: parseInt(m[1], 16) };
            }
            if ((m = input.skip(/^\d*(?:\.\d+)?/))) {
                return { type: "num", value: parseFloat(m[0]) };
            }
            if (is_punc(ch)) {
                return { type: "punc", value: input.next() };
            }
            if (ch == "'") {
                return { type: "str", value: read_escaped("'") };
            }
            if (ch == '"') {
                return { type: "$tr", value: read_escaped('"') };
            }
            if (is_id_start(ch)) {
                return { type: "sym", value: read_while(is_id_char) };
            }
        }

        function read_token() {
            if (next_tokens.length) {
                return next_tokens.shift();
            }
            if (input.eof()) {
                return null;
            }
            if (twig_mode) {
                skip_whitespace();
                return read_expr_token();
            }
            var m = input.skip(/^(.*?)(\{\{-?|\{\%-?|\{\#-?|$)/);
            var text = m[1];
            var trim = /-$/.test(m[2]);
            var tag = trim ? m[2].substr(0, 2) : m[2];
            if (trim) {
                text = text.replace(/\s+$/, "");
            }
            if (tag == "{{") {
                twig_mode = true;
                next_tokens.push({ type: "expr" });
            } else if (tag == "{%") {
                twig_mode = true;
                next_tokens.push({ type: "stat" });
            } else if (tag == "{#") {
                skip_comment();
            }
            return text ? { type: "text", value: text } : read_token();
        }

        function croak(msg) {
            input.croak(msg);
        }

        function next() {
            var tok = current;
            current = null;
            return tok || read_token();
        }

        function peek() {
            return current || (current = read_token());
        }

        function eof() {
            return peek() == null;
        }
    }

    function InputStream(input) {
        var pos = 0, line = 1, col = 0;
        return {
            next  : next,
            peek  : peek,
            eof   : eof,
            skip  : skip,
            croak : croak
        };
        function next() {
            var ch = input.charAt(pos++);
            if (ch == "\n") line++, col = 0; else col++;
            return ch;
        }
        function peek() {
            return input.charAt(pos);
        }
        function eof() {
            return peek() == "";
        }
        function skip(rx) {
            var str = input.substr(pos);
            var m = rx.exec(str);
            if (m && m[0].length) {
                pos += m[0].length;
                return m;
            }
        }
        function croak(msg) {
            throw new Error(msg + " (" + line + ":" + col + ")");
        }
    }

};


console.time("LEXER");
var t = TWIG();
t.init();
var l = t.Lexer("foo {# bar #}     {{ '123' starts with .25 + 0x20 ? answer.yes : answer.nope -}}   waka\
{% set X = { foo: 1, bar: 2 } %}\
{{foo}}{{bar}}\
");
while (!l.eof()) {
    console.log(l.next());
}
console.timeEnd("LEXER");
