TWEEG = function(){

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
    var NODE_INT_STR_BEG  = "intstr_beg";
    var NODE_INT_STR      = "intstr";
    var NODE_INT_STR_END  = "intstr_end";
    var NODE_SYMBOL       = "symbol";
    var NODE_COMMENT      = "comment";

    /* -----[ AST node types ]----- */

    var NODE_PROG         = "prog";
    var NODE_BOOLEAN      = "boolean";
    var NODE_NULL         = "null";
    var NODE_BINARY       = "binary";
    var NODE_UNARY        = "unary";
    var NODE_CONDITIONAL  = "conditional";
    var NODE_CALL         = "call";
    var NODE_FILTER       = "filter";
    var NODE_ARRAY        = "array";
    var NODE_HASH         = "hash";
    var NODE_INDEX        = "index";
    var NODE_STAT         = "stat";

    /* -----[ Lexer modes ]----- */

    var LEX_TEXT        = 1; // normal text mode
    var LEX_INTERPOL    = 2; // text in interpolated string
    var LEX_EXPRESSION  = 3; // expression in {{ }} or {% %}
    var LEX_INT_EXPR    = 4; // expression in #{ } inside interpolated string

    /* -----[ core tag parsers ]----- */

    var SYM_LOOP = {
        type: NODE_SYMBOL,
        value: "loop"
    };

    var CORE_TAGS = {
        "autoescape": {
            parse: function(X) {
                return {
                    type: X.parse_expression(),
                    body: (X.skip(NODE_STAT_END),
                           X.parse_until(X.end_body_predicate(/^endautoescape$/, true)))
                };
            }
        },

        "if": {
            parse: function(X) {
                var node = {
                    cond: X.parse_expression(),
                    then: (X.skip(NODE_STAT_END),
                           X.parse_until(X.end_body_predicate(/^(?:elseif|else|endif)$/)))
                };
                var tag = X.skip(NODE_SYMBOL).value;
                X.skip(NODE_STAT_END);
                if (tag == "else") {
                    node.else = X.parse_until(X.end_body_predicate(/^endif$/, true));
                } else if (tag == "elseif") {
                    node.else = X.parse_tag_if();
                }
                return node;
            },
            compile: function(env, X, node) {
                var condition = X.compile_bool(env, node.cond);
                var true_branch = X.compile(env, node.then);
                var else_branch = node.else && X.compile(env, node.else);
                return condition + "?" + true_branch + ":" + (else_branch || "");
            }
        },

        "for": {
            parse: function(X) {
                var node = {};
                node.sym = X.skip(NODE_SYMBOL);
                if (X.looking_at(NODE_PUNC, ",")) {
                    X.next();
                    node.sym2 = X.skip(NODE_SYMBOL); // key, val in {object}
                }
                X.skip(NODE_OPERATOR, "in");
                node.data = X.parse_expression();
                if (X.looking_at(NODE_SYMBOL, "if")) {
                    X.next();
                    node.cond = X.parse_expression();
                }
                X.skip(NODE_STAT_END);
                node.body = X.parse_until(X.end_body_predicate(/^(?:else|endfor)$/));
                var tag = X.skip(NODE_SYMBOL).value;
                X.skip(NODE_STAT_END);
                if (tag == "else") {
                    node.else = X.parse_until(X.end_body_predicate(/^endfor$/, true));
                }
                return node;
            },
            compile: function(env, X, node) {
                var data = X.compile(env, node.data);
                env = env.extend(node.sym.value, "loop");
                if (node.sym2) {
                    env.def(node.sym2.value);
                }
                var cond = node.cond ? X.compile(env, node.cond) : null;
                env = env.extend();
                var body = X.compile(env, node.body);
                var code = "TR.for(" + data + ","
                    + "function("
                    + X.compile_sym(env, SYM_LOOP);
                if (node.sym2) {
                    code += "," + X.compile_sym(env, node.sym2);
                }
                code += "," + X.compile_sym(env, node.sym) + "){";
                code += X.output_vars(env.own());
                if (cond != null) {
                    code += "if (!" + cond + ") return TR;";
                }
                code += "return " + body + ";})";
                return code;
            }
        },

        "do": {
            parse: function(X) {
                var node = { expr: X.parse_expression() };
                X.skip(NODE_STAT_END);
                return node;
            }
        },

        "set": {
            parse: function(X) {
                var defs = [ { name: X.skip(NODE_SYMBOL) } ];
                var node = { defs: defs };
                while (X.looking_at(NODE_PUNC, ",")) {
                    X.next();
                    defs.push({ name: X.skip(NODE_SYMBOL) });
                }
                var has_equal = X.looking_at(NODE_OPERATOR, "=");
                if (has_equal) {
                    X.next();
                    defs.forEach(function(def, i){
                        if (i) X.skip(NODE_PUNC, ",");
                        def.value = X.parse_expression();
                    });
                    X.skip(NODE_STAT_END);
                } else {
                    X.skip(NODE_STAT_END);
                    if (defs.length != 1) {
                        X.croak("`set` without equal must define exactly one variable");
                    }
                    defs[0].value = X.parse_until(X.end_body_predicate(/^endset$/, true));
                }
                return node;
            },
            compile: function(env, X, node) {
                return "(" + node.defs.map(function(def){
                    env.set(def.name.value);
                    return X.compile_sym(env, def.name)
                        + "=" + X.compile(env, def.value);
                }) + ",'')";
            }
        },

        "with": {
            parse: function(X) {
                var node = {};
                if (X.looking_at(NODE_SYMBOL, "only")) {
                    X.next();
                    node.only = true;
                }
                X.skip(NODE_STAT_END);
                node.body = X.parse_until(X.end_body_predicate(/^endwith$/, true));
                return node;
            }
        },

        "macro": {
            parse: function(X) {
                var node = {};
                node.name = X.skip(NODE_SYMBOL);
                node.vars = X.delimited("(", ")", ",", function(){
                    return X.skip(NODE_SYMBOL);
                });
                X.skip(NODE_STAT_END);
                node.body = X.parse_until(X.end_body_predicate(/^endmacro$/, true));
                return node;
            }
        },

        "spaceless": {
            parse: function(X) {
                X.skip(NODE_STAT_END);
                return {
                    body: X.parse_until(X.end_body_predicate(/^endspaceless$/, true))
                };
            }
        }
    };

    /* -----[ Das Environment ]----- */

    function Environment(parent) {
        this.vars = Object.create(parent ? parent.vars : null);
        this.parent = parent;
    }
    Environment.prototype = {
        extend: function() {
            var env = new Environment(this);
            for (var i = arguments.length; --i >= 0;) {
                env.def(arguments[i]);
            }
            return env;
        },
        lookup: function(name) {
            var scope = this;
            while (scope) {
                if (Object.prototype.hasOwnProperty.call(scope.vars, name))
                    return scope;
                scope = scope.parent;
            }
        },
        get: function(name) {
            if (name in this.vars)
                return this.vars[name];
            throw new Error("Undefined variable " + name);
        },
        set: function(name, value) {
            return (this.lookup(name) || this).def(name, value);
        },
        def: function(name, value) {
            return this.vars[name] = value;
        },
        own: function() {
            return Object.keys(this.vars);
        }
    };

    /* -----[ exports ]----- */

    var exports = {
        parse   : parse,
        Lexer   : Lexer,
        init    : init,
        compile : compile
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
        var rx = string.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
        if (/[a-z]$/i.test(string)) {
            rx += "\\b";
        }
        return rx;
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

    /* -----[ Das Parser ]----- */

    function parse(input) {
        input = Lexer(input);

        var context = {
            croak              : croak,
            delimited          : delimited,
            end_body_predicate : end_body_predicate,
            eof                : input.eof,
            is                 : is,
            looking_at         : looking_at,
            next               : next,
            parse_expression   : parse_expression,
            parse_next         : parse_next,
            parse_until        : parse_until,
            peek               : peek,
            skip               : skip
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
                var impl = CORE_TAGS[tag];
                if (!impl) {
                    croak("Tag `" + tag + "` is not supported");
                }
                var node = impl.parse(context);
                node.type = NODE_STAT;
                node.tag = tag;
                return node;
            }
            croak("Unexpected token");
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
            else if (looking_at(NODE_INT_STR_BEG)) {
                atom = parse_interpolated_string();
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
            if (func.type != NODE_SYMBOL) {
                croak("Unexpected function call");
            }
            return {
                type: NODE_CALL,
                func: func.value,
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
            if (tok.value == "null") {
                return { type: NODE_NULL, value: null };
            }
            return tok;
        }

        function parse_interpolated_string() {
            skip(NODE_INT_STR_BEG);
            var data = [];
            while (!looking_at(NODE_INT_STR_END)) {
                if (looking_at(NODE_INT_STR)) {
                    var tok = input.next();
                    if (tok.value.length) {
                        tok.type = NODE_STR;
                        data.push(tok);
                    }
                } else {
                    data.push(parse_expression());
                }
            }
            tok = skip(NODE_INT_STR_END);
            if (tok.value.length || !data.length) {
                tok.type = NODE_STR;
                data.push(tok);
            }
            return {
                type: NODE_INT_STR,
                data: data
            };
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

        /* -----[ the "maybe" functions ]----- */

        function maybe_binary(left, my_prec) {
            var tok = looking_at(NODE_OPERATOR);
            if (tok && BINARY_OPERATORS[tok.value]) {
                var his_prec = BINARY_OPERATORS[tok.value];
                if (his_prec > my_prec) {
                    next();
                    return maybe_binary({
                        type     : NODE_BINARY,
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
                var sym = skip(NODE_SYMBOL).value;
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

    /* -----[ Das Compiler ]----- */

    function compile(node, env) {
        if (!env) env = new Environment();
        var context = {
            compile          : compile,
            compile_sym      : compile_sym,
            compile_bool     : compile_bool,
            compile_num      : compile_num,
            compile_str      : compile_str,
            output_vars      : output_vars,
            mangle_name      : mangle_name
        };
        var globals = [];
        return (function(){
            var body = compile(env, node);
            var code = "function template(DATA, TR){";
            code += output_vars(env.own());
            if (globals.length) {
                code += "var " + globals.map(function(name){
                    return mangle_name(name) + "=DATA[" + JSON.stringify(name) + "]";
                }).join(",") + ";";
            }
            code += "return " + body + "}";
            return code;
        })();

        function compile(env, node) {
            // var loc = node.loc ? ("/*" + node.loc.line + ":" + node.loc.col + "*/") : "";
            var loc = "";
            return parens(loc + _compile(env, node));
        }

        function _compile(env, node) {
            switch (node.type) {
              case NODE_TEXT:
              case NODE_STR:
              case NODE_NUMBER:
              case NODE_BOOLEAN:
              case NODE_NULL:
                return JSON.stringify(node.value);

              case NODE_PROG:
                return compile_prog(env, node);

              case NODE_BINARY:
                return compile_binary(env, node);

              case NODE_CONDITIONAL:
                return compile_ternary(env, node);

              case NODE_UNARY:
                return compile_unary(env, node);

              case NODE_FILTER:
                return compile_filter(env, node);

              case NODE_INDEX:
                return compile_index(env, node);

              case NODE_ARRAY:
                return compile_array(env, node);

              case NODE_HASH:
                return compile_hash(env, node);

              case NODE_SYMBOL:
                return compile_sym(env, node);

              case NODE_STAT:
                return compile_stat(env, node);

              case NODE_CALL:
                return compile_call(env, node);

              case NODE_INT_STR:
                return compile_interpolated_str(env, node);
            }

            throw new Error("Cannot compile node " + JSON.stringify(node));
        }

        function parens(str) {
            return "(" + str + ")";
        }

        function compile_prog(env, node) {
            return "TR.out([" + node.body.map(function(item){
                return compile(env, item);
            }).join(",") + "])";
        }

        function compile_call(env, node) {
            return "TR.func[" + JSON.stringify(node.func)
                + "](" + node.args.map(function(item){
                    return compile(env, item);
                }).join(",") + ")";
        }

        function compile_index(env, node) {
            return compile(env, node.expr) + "[" + compile(env, node.prop) + "]";
        }

        function compile_filter(env, node) {
            var code = "TR.filter[" + JSON.stringify(node.name)
                + "](" + compile(env, node.expr);
            if (node.args.length) {
                code += "," + node.args.map(function(item){
                    return compile(env, item);
                }).join(",");
            }
            return code + ")";
        }

        function compile_bool(env, node) {
            return "TR.bool(" + compile(env, node) + ")";
        }

        function compile_str(env, node) {
            return "String(" + compile(env, node) + ")";
        }

        function compile_array(env, node) {
            return "[" + node.data.map(function(item){
                return compile(env, item);
            }).join(",") + "]";
        }

        function compile_hash(env, node) {
            return "TR.make_hash([" + node.data.map(function(item){
                return compile(env, item.key) + "," + compile(env, item.value);
            }).join(",") + "])";
        }

        function compile_interpolated_str(env, node) {
            return node.data.map(function(item){
                return item.type == NODE_STR
                    ? compile(env, item)
                    : "String(" + compile(env, item) + ")";
            }).join(" + ");
        }

        function compile_sym(env, node) {
            var name = node.value;
            if (!env.lookup(name) && globals.indexOf(name) < 0) {
                globals.push(name);
            }
            return mangle_name(name);
        }

        function mangle_name(name) {
            return "$_" + name;
        }

        function compile_binary(env, node) {
            var op = node.operator;
            switch (op) {
              case "?:":
                return compile_bool(env, node.left) + "||" + compile(env, node.right);

              case "or":
                return compile_bool(env, node.left) + "||" + compile_bool(env, node.right);

              case "and":
                return compile_bool(env, node.left) + "&&" + compile_bool(env, node.right);

              case "b-or":
                return compile_num(env, node.left) + "|" + compile_num(env, node.right);

              case "b-and":
                return compile_num(env, node.left) + "&" + compile_num(env, node.right);

              case "b-xor":
                return compile_num(env, node.left) + "^" + compile_num(env, node.right);

              case "==": case "!=": case "<": case ">": case ">=": case "<=":
                return compile(env, node.left) + op + compile(env, node.right);

              case "+": case "-": case "*": case "/": case "%":
                return compile_num(env, node.left) + op + compile_num(env, node.right);

              case "//":
                return "(" + compile_num(env, node.left) + "/" + compile_num(env, node.right) + ")|0";

              case "**":
                return "Math.power(" + compile_num(env, node.left) + "," + compile_num(env, node.right) + ")";

              case "~":
                return compile_str(env, node.left) + "+" + compile_str(env, node.right);

              case "not in":
                return "!" + compile_operator(env, "in", node);

              case "is":
                return compile(env, node.left) + "===" + compile(env, node.right);

              case "is not":
                return compile(env, node.left) + "!==" + compile(env, node.right);

              case "matches":
              case "starts with":
              case "ends with":
              case "..":
              case "in":
                return compile_operator(env, op, node);
            }

            throw new Error("Unknown operator " + op);
        }

        function compile_num(env, num) {
            return "TR.number(" + compile(env, num) + ")";
        }

        function compile_unary(env, node) {
            var op = node.operator;
            if (op == "not") op = "!";
            return op + compile(env, node.expr);
        }

        function compile_ternary(env, node) {
            return compile_bool(env, node.cond)
                + "?" + compile(env, node.then)
                + ":" + compile(env, node.else);
        }

        function compile_operator(env, op, node) {
            return "TR.operator[" + JSON.stringify(op) + "]("
                + compile(env, node.left) + "," + compile(env, node.right) + ")";
        }

        function compile_stat(env, node) {
            var impl = CORE_TAGS[node.tag];
            if (!impl || !impl.compile) {
                throw new Error("Compiler not implemented for `" + node.tag + "`");
            }
            return impl.compile(env, context, node);
        }

        function output_vars(vars) {
            if (vars.length) {
                return "var " + vars.map(function(name){
                    return mangle_name(name);
                }) + ";";
            }
            return "";
        }
    }

    /* -----[ Das Lexer ]----- */

    function Lexer(input) {
        input = InputStream(input);
        var peeked = [];
        var state = [ LEX_TEXT ];
        var current;
        return {
            next  : next,
            peek  : peek,
            ahead : ahead,
            eof   : eof,
            croak : croak
        };

        function push_state(s) {
            state.push(s);
        }

        function pop_state() {
            state.pop();
        }

        function mode() {
            return state[state.length - 1];
        }

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
            if (mode() == LEX_INT_EXPR && input.skip(/^\}/)) {
                pop_state();
                return read_interpol_part();
            }
            if ((m = input.skip(/^(?:-?\%\}|-?\}\})/))) {
                pop_state();
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
                input.next();
                push_state(LEX_INTERPOL);
                return token(NODE_INT_STR_BEG);
            }
            if (is_id_start(ch)) {
                return token(NODE_SYMBOL, read_while(is_id_char));
            }
            return croak("Unexpected input in expression");
        }

        function read_interpol_part() {
            var escaped = false, str = "";
            while (!input.eof()) {
                if (escaped) {
                    str += input.next();
                    escaped = false;
                } else if (input.skip(/^\\/)) {
                    escaped = true;
                } else if (input.skip(/^\#\{/)) {
                    push_state(LEX_INT_EXPR);
                    return token(NODE_INT_STR, str);
                } else if (input.skip(/^\"/)) {
                    pop_state();
                    return token(NODE_INT_STR_END, str);
                } else {
                    str += input.next();
                }
            }
            throw new Error("Unfinished interpolated string");
        }

        function read_token() {
            var m, text;
            if (input.eof()) {
                return null;
            }
            start_token();
            if (mode() == LEX_INTERPOL) {
                return read_interpol_part();
            }
            if (mode() >= LEX_EXPRESSION) {
                skip_whitespace();
                return read_expr_token();
            }
            if ((m = input.skip(/^(\{\{|\{\%|\{#)-?\s*/))) {
                var tag = m[1];
                if (tag == "{{") {
                    push_state(LEX_EXPRESSION);
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
                        push_state(LEX_EXPRESSION);
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

    /* -----[ Lexer utilities ]----- */

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
