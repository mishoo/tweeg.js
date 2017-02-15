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

    var NODE_TEXT         = "text";
    var NODE_EXPR_BEG     = "expr_beg";
    var NODE_STAT_BEG     = "stat_beg";
    var NODE_EXPR_END     = "expr_end";
    var NODE_STAT_END     = "stat_end";
    var NODE_OPERATOR     = "operator";
    var NODE_NUMBER       = "number";
    var NODE_PUNC         = "punc";
    var NODE_STR          = "string";
    var NODE_INT_STR      = "interpolated_string";
    var NODE_SYMBOL       = "symbol";
    var NODE_COMMENT      = "comment";

    /* -----[ AST node types ]----- */

    var NODE_PROG         = "prog";
    var NODE_BOOLEAN      = "boolean";
    var NODE_ASSIGN       = "assign";
    var NODE_BINARY       = "binary";
    var NODE_UNARY        = "unary";
    var NODE_CONDITIONAL  = "conditional";
    var NODE_CALL         = "call";
    var NODE_FILTER       = "filter";
    var NODE_ARRAY        = "array";
    var NODE_HASH         = "hash";
    var NODE_INDEX        = "index";

    var exports = {
        parse: parse,
        Lexer: Lexer,
        init: init
    };
    return exports;

    function init() {
        var rx = "^(?:" + ALL_OPERATORS.sort(function(a, b){
            return b.length - a.length;
        }).map(quote_regexp).join("|") + ")";
        RX_OPERATOR = new RegExp(rx);
        return exports;
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

        var CORE_TAGS = {
            "if": parse_tag_if
        };

        return parse_until(function(){ return false });

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
                next();
                var tag = skip(NODE_SYMBOL).value;
                var parser = CORE_TAGS[tag];
                var node = parser();
                node.type = "stat";
                node.tag = tag;
                return node;
            }
        }

        function parse_expression() {
            return maybe_ternary(
                maybe_call(
                    maybe_binary(parse_atom(), 0)));
        }

        function parse_atom() {
            var atom, tok;
            if (looking_at(NODE_PUNC, "(")) {
                next();
                atom = parse_expression();
                skip(NODE_PUNC, ")");
            }
            else if (looking_at(NODE_PUNC, "{")) {
                atom = parse_hash();
            }
            else if (looking_at(NODE_PUNC, "[")) {
                atom = parse_array();
            }
            else if (looking_at(NODE_SYMBOL)) {
                atom = parse_symbol();
            }
            else if (looking_at(NODE_NUMBER) || looking_at(NODE_STR)) {
                atom = next();
            }
            else if ((tok = looking_at(NODE_OPERATOR)) && UNARY_OPERATORS[tok.value]) {
                atom = {
                    type: NODE_UNARY,
                    operator: next().value,
                    expr: parse_atom()
                };
            } else {
                croak("Unexpected token in expression");
            }
            return maybe_filter(maybe_call(maybe_index(atom)));
        }

        function parse_call(func) {
            return {
                type: NODE_CALL,
                func: func,
                args: delimited("(", ")", ",", parse_expression)
            };
        }

        function parse_symbol() {
            var tok = next();
            if (tok.value == "true") {
                return { type: NODE_BOOLEAN, value: true };
            }
            if (tok.value == "false") {
                return { type: NODE_BOOLEAN, value: false };
            }
            return tok;
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
            if (looking_at(NODE_SYMBOL)) {
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

        function parse_until(pred) {
            var body = [];
            while (!input.eof() && !pred()) {
                body.push(parse_next());
            }
            return { type: NODE_PROG, body: body };
        }

        function end_body_predicate(rx, skip_end) {
            return function() {
                return input.ahead(2, function(tokens, consume) {
                    if (is(tokens[0], NODE_STAT_BEG)) {
                        var tag = is(tokens[1], NODE_SYMBOL);
                        if (tag && rx.test(tag.value)) {
                            consume(skip_end ? 2 : 1);
                            if (skip_end) {
                                skip(NODE_STAT_END);
                            }
                            return true;
                        }
                    }
                });
            };
        }

        /* -----[ core tag parsers ]----- */

        function parse_tag_if() {
            var node = {};
            node["cond"] = parse_expression();
            skip(NODE_STAT_END);
            node["then"] = parse_until(end_body_predicate(/^(?:elseif|else|endif)$/));
            var tag = skip(NODE_SYMBOL).value;
            skip(NODE_STAT_END);
            if (tag == "else") {
                node.else = parse_until(end_body_predicate(/^endif$/, true));
            } else if (tag == "elseif") {
                node.else = parse_tag_if();
            }
            return node;
        }

        /* -----[ the "maybe" functions ]----- */

        function maybe_binary(left, my_prec) {
            var tok = looking_at(NODE_OPERATOR);
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
            if (looking_at(NODE_OPERATOR, "?")) {
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
            return looking_at(NODE_PUNC, "(") ? parse_call(expr) : expr;
        }

        function maybe_filter(expr) {
            if (looking_at(NODE_OPERATOR, "|")) {
                next();
                var sym = skip(NODE_SYMBOL);
                var args = looking_at(NODE_PUNC, "(")
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

        function maybe_index(expr) {
            var prop;
            if (looking_at(NODE_PUNC, "[")) {
                next();
                prop = parse_expression();
                skip(NODE_PUNC, "]");
                return {
                    type: NODE_INDEX,
                    expr: expr,
                    prop: prop
                };
            }
            if (looking_at(NODE_PUNC, ".")) {
                next();
                prop = skip(NODE_SYMBOL);
                prop.type = NODE_STR;
                return {
                    type: NODE_INDEX,
                    expr: expr,
                    prop: prop
                };
            }
            return expr;
        }

        /* -----[ other parse utilities ]----- */

        function delimited(start, stop, separator, parser) {
            var a = [], first = true;
            skip(NODE_PUNC, start);
            while (!input.eof()) {
                if (looking_at(NODE_PUNC, stop)) break;
                if (first) first = false; else skip(NODE_PUNC, separator);
                if (looking_at(NODE_PUNC, stop)) break;
                a.push(parser());
            }
            skip(NODE_PUNC, stop);
            return a;
        }

        function croak(msg) {
            input.croak(msg);
        }

        function is(tok, type, value) {
            return tok && tok.type == type
                && (value == null || tok.value === value) ? tok : null;
        }

        function looking_at(type, value) {
            return is(peek(), type, value);
        }

        function skip(type, value) {
            var seen = arguments.length == 1
                ? looking_at(type)
                : looking_at(type, value);
            if (seen) {
                return next();
            } else {
                return croak("Expecting " + type + ", got: " + dump(peek()));
            }
        }

        function dump(node) {
            return JSON.stringify(node);
        }
    }

    function Lexer(input) {
        input = InputStream(input);
        var peeked = [];
        var twig_mode = false;
        var current;
        return {
            next  : next,
            peek  : peek,
            ahead : ahead,
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
            var m, ch = input.peek();
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
            return croak("Unexpected input in expression");
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
            var m, text;
            if ((m = input.skip(/^(\{\{|\{\%|\{#)-?\s*/))) {
                var tag = m[1];
                if (tag == "{{") {
                    twig_mode = true;
                    return token(NODE_EXPR_BEG);
                } else if (tag == "{%") {
                    // handle verbatim blocks here, as if we parse
                    // them normally it'll be harder to reconstruct
                    // the original text
                    if ((m = input.skip(/^verbatim\s*(-?)\%\}/))) {
                        if (m[1]) {
                            skip_whitespace();
                        }
                        m = input.skip(/^([^]*?)\{\%(-?)\s*endverbatim\s*(-?)\%\}/);
                        if (!m) {
                            croak("Unfinished verbatim block");
                        }
                        text = m[1];
                        if (m[2]) {
                            text = text.replace(/\s+$/, "");
                        }
                        if (m[3]) {
                            skip_whitespace();
                        }
                        return text ? token(NODE_TEXT, text) : read_token();
                    } else {
                        twig_mode = true;
                        return token(NODE_STAT_BEG);
                    }
                } else if (tag == "{#") {
                    return token(NODE_COMMENT, skip_comment());
                } else {
                    return croak("Attention: there is a hole in the time/space continuum");
                }
            }
            m = input.skip(/^[^]*?(?=\{\{|\{\%|\{\#|$)/);
            text = m[0];
            if (input.looking_at(/^..-/)) {
                // the following tag wants trimming
                text = text.replace(/\s+$/, "");
            }
            return text ? token(NODE_TEXT, text) : read_token();
        }

        function croak(msg) {
            input.croak(msg);
        }

        function next() {
            return peeked.length ? peeked.shift() : read_token();
        }

        function peek() {
            if (!peeked.length) {
                peeked.push(read_token());
            }
            return peeked[0];
        }

        function ahead(count, func) {
            var n = count - peeked.length;
            while (!input.eof() && n-- > 0) {
                peeked.push(read_token());
            }
            return func.call(null, peeked, function(n){
                peeked.splice(0, n == null ? count : n);
            });
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
            next        : next,
            peek        : peek,
            eof         : eof,
            skip        : skip,
            croak       : croak,
            looking_at  : looking_at,
            pos         : function() {
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
        function looking_at(rx) {
            return rx.exec(input.substr(pos));
        }
        function skip(rx) {
            var m = looking_at(rx);
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

var t = TWIG().init();
console.time("PARSER");
var code = "<p>    {{- a + b['wak' + 'mak'] }}</p>";
var code = "<p>{% if foo + bar == 0 %} ZERO {% else %} blah {% endif %}";
var ast = t.parse(code);
console.timeEnd("PARSER");
console.log(JSON.stringify(ast, null, 2));

// var t = TWIG().init();
// var l = t.Lexer("foo {% if expr %} bar {% else %} baz {% endif %}");
// l.ahead(3, function(tokens, consume){
//     console.log(tokens);
//     consume();
// });
// console.log(l.next());
// console.log(l.next());
// console.log(l.next());

// console.time("LEXER");
// var t = TWIG();
// t.init();
// // var l = t.Lexer("foo {# bar #}     {{- '123' starts with .25 + 0x20 ? answer.yes : answer.nope -}}   waka\n\
// //  {% set X = { foo: 1, \"bar\": 2 } %}\
// // {{foo}}{{bar}}\
// // ");
// var l = t.Lexer("foo    \n\
// {%- verbatim -%}\n\
//   {{ ckt }}\n\
// {%- endverbatim -%}\n\
//   {{wakabar}}");
// var a = [];
// while (!l.eof()) {
//     a.push(l.next());
// }
// console.timeEnd("LEXER");
// console.log(a);
