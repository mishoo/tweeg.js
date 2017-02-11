TWIG = function(){

    "use strict";

    var ALL_OPERATORS = [ "?", "|", "=" ];

    var UNARY_OPERATORS = make_operators([
        [ "not" ],
        [ "-", "+" ]
    ]);

    var BINARY_OPERATORS = make_operators([
        [ "?:" ],
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

    var NODE_TEXT     = "text";
    var NODE_EXPR_BEG = "expr_beg";
    var NODE_STAT_BEG = "stat_beg";
    var NODE_EXPR_END = "expr_end";
    var NODE_STAT_END = "stat_end";
    var NODE_OPERATOR = "operator";
    var NODE_NUMBER   = "number";
    var NODE_PUNC     = "punc";
    var NODE_STR      = "string";
    var NODE_INT_STR  = "interpolated_string";
    var NODE_SYMBOL   = "symbol";
    var NODE_COMMENT  = "comment";

    /* -----[ AST node types ]----- */

    var NODE_TEMPLATE = "template";
    var NODE_BOOLEAN = "boolean";
    var NODE_ASSIGN = "assign";
    var NODE_BINARY = "binary";
    var NODE_UNARY = "unary";
    var NODE_CONDITIONAL = "conditional";
    var NODE_CALL = "call";
    var NODE_FILTER = "filter";
    var NODE_ARRAY = "array";
    var NODE_HASH = "hash";
    var NODE_HASH_ENTRY = "hash_entry";

    // XXX: we'll export more during development, but should remove
    // what isn't essential.  For instance, there's no need for
    // someone else to mess with our Lexer.
    var self = {
        parse: parse,
        Lexer: Lexer,
        init: init
    };
    return self;

    function init() {
        var rx = "^(?:" + ALL_OPERATORS.sort(function(a, b){
            return b.length - a.length;
        }).map(quote_regexp).join("|") + ")";
        RX_OPERATOR = new RegExp(rx);
        return self;
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
        input = Lexer(input);

        return (function(ast){
            while (!input.eof()) {
                ast.body.push(parse_next());
            }
            return ast;
        })({ type: NODE_TEMPLATE, body: [] });

        function peek() {
            var tok;
            while ((tok = input.peek()) && tok.type == NODE_COMMENT)
                input.next();
            return tok;
        }

        function next() {
            peek();
            return input.next();
        }

        function parse_next() {
            var tok = peek();
            if (tok.type == NODE_TEXT) {
                return next();
            }
            if (tok.type == NODE_EXPR_BEG) {
                next();
                var expr = parse_expression();
                skip(NODE_EXPR_END);
                return expr;
            }
            if (tok.type == NODE_STAT_BEG) {
                croak("Not implemented");
            }
        }

        function parse_expression() {
            return maybe_ternary(
                maybe_call(
                    maybe_binary(parse_atom(), 0)));
        }

        function parse_atom() {
            var atom, tok;
            if (seeing(NODE_PUNC, "(")) {
                next();
                atom = parse_expression();
                skip(NODE_PUNC, ")");
            }
            else if (seeing(NODE_PUNC, "{")) {
                atom = parse_hash();
            }
            else if (seeing(NODE_PUNC, "[")) {
                atom = parse_array();
            }
            else if (seeing(NODE_SYMBOL)) {
                atom = parse_symbol();
            }
            else if (seeing(NODE_NUMBER) || seeing(NODE_STR)) {
                atom = next();
            }
            else if ((tok = seeing(NODE_OPERATOR)) && UNARY_OPERATORS[tok.value]) {
                atom = {
                    type: NODE_UNARY,
                    operator: next().value,
                    expr: parse_atom()
                };
            } else {
                croak("Unexpected token in expression");
            }
            return maybe_call(maybe_filter(atom));
        }

        function parse_array() {
            return {
                type: NODE_ARRAY,
                data: delimited("[", "]", ",", parse_expression)
            };
        }

        function parse_hash() {
            return {
                type: NODE_HASH,
                data: delimited("{", "}", ",", parse_hash_entry)
            };
        }

        function parse_hash_entry() {
            var key;
            if (seeing(NODE_SYMBOL)) {
                key = next();
                key.type = NODE_STR;
            } else {
                key = parse_expression();
            }
            skip(NODE_PUNC, ":");
            return {
                key: key,
                value: parse_expression()
            };
        }

        function maybe_binary(left, my_prec) {
            var tok = seeing(NODE_OPERATOR);
            if (tok && BINARY_OPERATORS[tok.value]) {
                var his_prec = BINARY_OPERATORS[tok.value];
                if (his_prec > my_prec) {
                    next();
                    return maybe_binary({
                        type     : tok.value == "=" ? NODE_ASSIGN : NODE_BINARY,
                        operator : tok.value,
                        left     : left,
                        right    : maybe_binary(parse_atom(), his_prec)
                    }, my_prec);
                }
            }
            return left;
        }

        function maybe_ternary(expr) {
            if (seeing(NODE_OPERATOR, "?")) {
                next();
                expr = {
                    type: NODE_CONDITIONAL,
                    cond: expr,
                    then: parse_expression(),
                    else: (skip(NODE_PUNC, ":"), parse_expression())
                };
            }
            return expr;
        }

        function maybe_call(expr) {
            return seeing(NODE_PUNC, "(") ? parse_call(expr) : expr;
        }

        function maybe_filter(expr) {
            if (seeing(NODE_OPERATOR, "|")) {
                next();
                var sym = skip(NODE_SYMBOL);
                var args = seeing(NODE_PUNC, "(")
                    ? delimited("(", ")", ",", parse_expression)
                    : [];
                expr = {
                    type: NODE_FILTER,
                    expr: expr,
                    name: sym,
                    args: args
                };
            }
            return expr;
        }

        function parse_call(func) {
            return {
                type: NODE_CALL,
                func: func,
                args: delimited("(", ")", ",", parse_expression)
            };
        }

        function delimited(start, stop, separator, parser) {
            var a = [], first = true;
            skip(NODE_PUNC, start);
            while (!input.eof()) {
                if (seeing(NODE_PUNC, stop)) break;
                if (first) first = false; else skip(NODE_PUNC, separator);
                if (seeing(NODE_PUNC, stop)) break;
                a.push(parser());
            }
            skip(NODE_PUNC, stop);
            return a;
        }

        function parse_symbol() {
            var tok = input.next();
            if (tok.value == "true") {
                return { type: NODE_BOOLEAN, value: true };
            }
            if (tok.value == "false") {
                return { type: NODE_BOOLEAN, value: false };
            }
            return tok;
        }

        function croak(msg) {
            input.croak(msg);
        }

        function seeing(type, value) {
            var tok = peek();
            if (arguments.length == 1) {
                return tok && tok.type == type ? tok : null;
            }
            return tok && tok.type == type && tok.value === value ? tok : null;
        }

        function skip(type, value) {
            var seen = arguments.length == 1
                ? seeing(type)
                : seeing(type, value);
            if (seen) {
                return next();
            } else {
                croak("Expecting " + type + ", got: " + dump(peek()));
            }
        }

        function dump(node) {
            return JSON.stringify(node);
        }
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
                return token(tmp == "}}" ? NODE_EXPR_END : NODE_STAT_END);
            }
            ch = input.peek();
            if (ch == null) {
                return null;
            }
            if ((m = input.skip(RX_OPERATOR))) {
                return token(NODE_OPERATOR, m[0]);
            }
            if ((m = input.skip(/^0x([0-9a-fA-F]+)/))) {
                return token(NODE_NUMBER, parseInt(m[1], 16));
            }
            if ((m = input.skip(/^\d*(?:\.\d+)?/))) {
                return token(NODE_NUMBER, parseFloat(m[0]));
            }
            if (is_punc(ch)) {
                return token(NODE_PUNC, input.next());
            }
            if (ch == "'") {
                return token(NODE_STR, read_escaped("'"));
            }
            if (ch == '"') {
                return token(NODE_INT_STR, read_escaped('"'));
            }
            if (is_id_start(ch)) {
                return token(NODE_SYMBOL, read_while(is_id_char));
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
                    return token(NODE_EXPR_BEG);
                } else if (tag == "{%") {
                    twig_mode = true;
                    return token(NODE_STAT_BEG);
                } else if (tag == "{#") {
                    return token(NODE_COMMENT, skip_comment());
                }
                croak("Attention: there is a hole in the time/space continuum");
            }
            m = input.skip(/^[^]*?(?=\{\{|\{\%|\{\#|$)/);
            var text = m[0];
            if (input.seeing(/^..-/)) {
                // the following tag wants trimming
                text = text.replace(/\s+$/, "");
            }
            return text ? token(NODE_TEXT, text) : read_token();
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

console.time("PARSER");
var t = TWIG().init();
var ast = t.parse("{{ { foo: 1, (bar): [2, 3] } }}");
console.timeEnd("PARSER");
console.log(JSON.stringify(ast, null, 2));


// console.time("LEXER");
// var t = TWIG();
// t.init();
// var l = t.Lexer("foo {# bar #}     {{- '123' starts with .25 + 0x20 ? answer.yes : answer.nope -}}   waka\n\
//  {% set X = { foo: 1, \"bar\": 2 } %}\
// {{foo}}{{bar}}\
// ");
// console.timeEnd("LEXER");
// while (!l.eof()) {
//     console.log(l.next());
// }
