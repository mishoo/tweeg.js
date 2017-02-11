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

    var RX_OPERATOR;            // populated by `init()`

    /* -----[ Token types ]----- */

    // var TOK_TEXT     = 1;
    // var TOK_EXPR_BEG = 2;
    // var TOK_STAT_BEG = 3;
    // var TOK_EXPR_END = 4;
    // var TOK_STAT_END = 5;
    // var TOK_OPERATOR = 6;
    // var TOK_NUMBER   = 7;
    // var TOK_PUNC     = 8;
    // var TOK_STR      = 9;
    // var TOK_INT_STR  = 10;
    // var TOK_SYMBOL   = 11;
    // var TOK_COMMENT  = 12;

    var TOK_TEXT     = "text";
    var TOK_EXPR_BEG = "expr_beg";
    var TOK_STAT_BEG = "stat_beg";
    var TOK_EXPR_END = "expr_end";
    var TOK_STAT_END = "stat_end";
    var TOK_OPERATOR = "operator";
    var TOK_NUMBER   = "number";
    var TOK_PUNC     = "punc";
    var TOK_STR      = "string";
    var TOK_INT_STR  = "interpolated_string";
    var TOK_SYMBOL   = "symbol";
    var TOK_COMMENT  = "comment";

    // XXX: we'll export more during development, but should remove
    // what isn't essential.  For instance, there's no need for
    // someone else to mess with our Lexer.
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

    function quote_regexp(string) {
        return string.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
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

    function parse(input) {

    }

    function Lexer(input) {
        input = InputStream(input);
        var peeked_token;
        var twig_mode = false;
        var current;
        return {
            next  : next,
            peek  : peek,
            eof   : eof,
            croak : croak
        };

        function start_token() {
            current = { loc: input.pos() };
        }

        function token(type, value) {
            current.type = type;
            if (arguments.length > 1) {
                current.value = value;
            }
            return current;
        }

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
                    return str;
                } else {
                    str += ch;
                }
            }
            croak("Unfinished string");
        }

        function skip_comment() {
            var m = input.skip(/^(.*?)(-?\#\})/);
            if (!m) {
                croak("Unfinished comment");
            }
            if (m[2].charAt(0) == "-") {
                skip_whitespace();
            }
            return m[1];
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
                return token(tmp == "}}" ? TOK_EXPR_END : TOK_STAT_END);
            }
            ch = input.peek();
            if (ch == null) {
                return null;
            }
            if ((m = input.skip(RX_OPERATOR))) {
                return token(TOK_OPERATOR, m[0]);
            }
            if ((m = input.skip(/^0x([0-9a-fA-F]+)/))) {
                return token(TOK_NUMBER, parseInt(m[1], 16));
            }
            if ((m = input.skip(/^\d*(?:\.\d+)?/))) {
                return token(TOK_NUMBER, parseFloat(m[0]));
            }
            if (is_punc(ch)) {
                return token(TOK_PUNC, input.next());
            }
            if (ch == "'") {
                return token(TOK_STR, read_escaped("'"));
            }
            if (ch == '"') {
                return token(TOK_INT_STR, read_escaped('"'));
            }
            if (is_id_start(ch)) {
                return token(TOK_SYMBOL, read_while(is_id_char));
            }
            croak("Unexpected input in expression");
        }

        function read_token() {
            if (input.eof()) {
                return null;
            }
            start_token();
            if (twig_mode) {
                skip_whitespace();
                return read_expr_token();
            }
            var m;
            if ((m = input.skip(/^(\{\{|\{\%|\{#)-?/))) {
                var tag = m[1];
                if (tag == "{{") {
                    twig_mode = true;
                    return token(TOK_EXPR_BEG);
                } else if (tag == "{%") {
                    twig_mode = true;
                    return token(TOK_STAT_BEG);
                } else if (tag == "{#") {
                    return token(TOK_COMMENT, skip_comment());
                }
                croak("Attention: there is a hole in the time/space continuum");
            }
            m = input.skip(/^[^]*?(?=\{\{|\{\%|\{\#|$)/);
            var text = m[0];
            if (input.seeing(/^..-/)) {
                // the following tag wants trimming
                text = text.replace(/\s+$/, "");
            }
            return text ? token(TOK_TEXT, text) : read_token();
        }

        function croak(msg) {
            input.croak(msg);
        }

        function next() {
            var tok = peeked_token;
            peeked_token = null;
            return tok || read_token();
        }

        function peek() {
            return peeked_token || (peeked_token = read_token());
        }

        function eof() {
            return peek() == null;
        }
    }

    function InputStream(input, pos, line, col) {
        pos = pos || 0;
        line = line || 1;
        col = col || 0;
        return {
            next   : next,
            peek   : peek,
            eof    : eof,
            skip   : skip,
            croak  : croak,
            seeing : seeing,
            pos    : function() {
                return { pos: pos, line: line, col: col };
            }
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
        function seeing(rx) {
            var str = input.substr(pos);
            return rx.exec(str);
        }
        function skip(rx) {
            var str = input.substr(pos);
            var m = rx.exec(str);
            if (m && m[0].length) {
                for (var i = m[0].length; --i >= 0;) next();
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
var l = t.Lexer("foo {# bar #}     {{- '123' starts with .25 + 0x20 ? answer.yes : answer.nope -}}   waka\n\
 {% set X = { foo: 1, \"bar\": 2 } %}\
{{foo}}{{bar}}\
");
while (!l.eof()) {
    console.log(l.next());
}
console.timeEnd("LEXER");
