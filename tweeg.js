TWEEG = function(RUNTIME){

    "use strict";

    var ALL_OPERATORS = [ "?", "|", "=", "=>" ];

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
        [ "==", "!=", "<", ">", ">=", "<=", "<=>",
          "not in", "in", "matches", "starts with", "ends with" ],
        [ ".." ],
        [ "+", "-" ],
        [ "~" ],
        [ "*", "/", "//", "%" ],
        [ "is", "is not" ],
        [ "**" ],
        [ "??" ]
    ]);

    var PRECEDENCE_NOT = 105;   // XXX: ugly

    var RX_WHITESPACE = /^[ \u00a0\n\r\t\f\u000b\u200b\u2000\u2001\u2002\u2003\u2004\u2005\u2006\u2007\u2008\u2009\u200a\u2028\u2029\u202f\u205f\u3000\uFEFF]+/;

    var RX_TEST_OPS = /^(?:constant|defined|divisible|empty|even|iterable|null|odd|same)$/;

    var RX_OPERATOR;            // populated by `init()`

    var GENSYM = 0;

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
    var NODE_COND         = "cond";
    var NODE_CALL         = "call";
    var NODE_FILTER       = "filter";
    var NODE_ARRAY        = "array";
    var NODE_HASH         = "hash";
    var NODE_INDEX        = "index";
    var NODE_STAT         = "stat";
    var NODE_TEST_OP      = "test_op";
    var NODE_ESCAPE       = "escape";
    var NODE_SLICE        = "slice";
    var NODE_VAR          = "var";
    var NODE_SEQ          = "seq";
    var NODE_LAMBDA       = "lambda";

    /* -----[ Lexer modes ]----- */

    var LEX_TEXT        = 1; // normal text mode
    var LEX_INTERPOL    = 2; // text in interpolated string
    var LEX_EXPRESSION  = 3; // expression in {{ }} or {% %}
    var LEX_INT_EXPR    = 4; // expression in #{ } inside interpolated string

    var EMPTY_STRING = { type: NODE_STR, value: "" };

    var NODES = {
        NODE_TEXT        : NODE_TEXT,
        NODE_EXPR_BEG    : NODE_EXPR_BEG,
        NODE_STAT_BEG    : NODE_STAT_BEG,
        NODE_EXPR_END    : NODE_EXPR_END,
        NODE_STAT_END    : NODE_STAT_END,
        NODE_OPERATOR    : NODE_OPERATOR,
        NODE_NUMBER      : NODE_NUMBER,
        NODE_PUNC        : NODE_PUNC,
        NODE_STR         : NODE_STR,
        NODE_INT_STR_BEG : NODE_INT_STR_BEG,
        NODE_INT_STR     : NODE_INT_STR,
        NODE_INT_STR_END : NODE_INT_STR_END,
        NODE_SYMBOL      : NODE_SYMBOL,
        NODE_COMMENT     : NODE_COMMENT,
        NODE_PROG        : NODE_PROG,
        NODE_BOOLEAN     : NODE_BOOLEAN,
        NODE_NULL        : NODE_NULL,
        NODE_BINARY      : NODE_BINARY,
        NODE_UNARY       : NODE_UNARY,
        NODE_COND        : NODE_COND,
        NODE_CALL        : NODE_CALL,
        NODE_FILTER      : NODE_FILTER,
        NODE_ARRAY       : NODE_ARRAY,
        NODE_HASH        : NODE_HASH,
        NODE_INDEX       : NODE_INDEX,
        NODE_STAT        : NODE_STAT,
        NODE_TEST_OP     : NODE_TEST_OP,
        NODE_ESCAPE      : NODE_ESCAPE,
        NODE_SLICE       : NODE_SLICE,
        NODE_VAR         : NODE_VAR,
        NODE_SEQ         : NODE_SEQ,
        NODE_LAMBDA      : NODE_LAMBDA,

        EMPTY_STRING     : EMPTY_STRING
    };

    /* -----[ core tag parsers ]----- */

    var CORE_TAGS = {
        "autoescape": {
            parse: function(X) {
                var strategy = X.looking_at(NODE_STAT_END) ? "html" : X.parse_atom();
                if (!is_constant(strategy)) {
                    X.croak("Autoescape strategy must be a constant");
                }
                return {
                    strategy: strategy.value,
                    body: (X.skip(NODE_STAT_END),
                           X.parse_until(X.end_body_predicate(/^endautoescape$/, true)))
                };
            },
            compile: function(env, X, node) {
                return X.with_escaping(node.strategy, function(){
                    return X.compile(env, node.body);
                });
            }
        },

        "filter": {
            parse: function(X) {
                function parse_filter() {
                    return {
                        name: X.skip(NODE_SYMBOL),
                        args: (X.looking_at(NODE_PUNC, "(")
                               ? X.delimited("(", ")", ",", X.parse_expression)
                               : [])
                    };
                }
                var node = {
                    filters: [ parse_filter() ]
                };
                while (X.looking_at(NODE_OPERATOR, "|")) {
                    X.next();
                    node.filters.push(parse_filter());
                }
                X.skip(NODE_STAT_END);
                node.body = X.parse_until(X.end_body_predicate(/^endfilter$/, true));
                return node;
            },
            compile: function(env, X, node) {
                var expr = node.filters.reduce(function(expr, filter){
                    return {
                        type: NODE_FILTER,
                        name: filter.name,
                        args: filter.args,
                        expr: expr
                    };
                }, node.body);
                return X.compile(env, expr);
            }
        },

        "if": {
            parse: function parse_if(X) {
                var node = {
                    cond: X.parse_expression(),
                    then: (X.skip(NODE_STAT_END),
                           X.parse_until(X.end_body_predicate(/^(?:elseif|else|endif)$/)))
                };
                var tag = X.skip(NODE_SYMBOL).value;
                if (tag == "else") {
                    X.skip(NODE_STAT_END);
                    node.else = X.parse_until(X.end_body_predicate(/^endif$/, true));
                } else if (tag == "elseif") {
                    node.else = parse_if(X);
                    node.else.type = NODE_STAT;
                    node.else.tag = "if";
                } else {
                    X.skip(NODE_STAT_END);
                }
                return node;
            },
            compile: function(env, X, node) {
                return X.compile(env, {
                    type: NODE_COND,
                    cond: node.cond,
                    then: node.then,
                    else: node.else || EMPTY_STRING
                });
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
                var code = "$FOR(" + data + ","
                    + "function("
                    + X.output_name("loop");
                if (node.sym2) {
                    code += "," + X.output_name(node.sym2.value);
                }
                code += "," + X.output_name(node.sym.value) + "){";
                code += X.output_vars(env.own());
                code += "if(!" + X.output_name("loop") + "){";
                if (node.else) {
                    code += "return " + X.compile(env, node.else);
                } else {
                    code += "return''";
                }
                code += "}";
                if (cond != null) {
                    code += "if(!" + cond + ")return $TR;";
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
            },
            compile: function(env, X, node) {
                return "(" + X.compile(env, node.expr) + ",'')";
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
                        X.croak("`set` with a text block must define exactly one variable");
                    }
                    defs[0].value = X.parse_until(X.end_body_predicate(/^endset$/, true));
                }
                return node;
            },
            compile: function(env, X, node) {
                return "(" + node.defs.map(function(def){
                    var value = X.compile(env, def.value);
                    env.set(def.name.value);
                    return X.output_name(def.name.value)
                        + "=" + value;
                }) + ",'')";
            }
        },

        "with": {
            parse: function(X) {
                var node = {};
                function maybe_only() {
                    if (X.looking_at(NODE_SYMBOL, "only")) {
                        X.next();
                        return node.only = true;
                    }
                }
                if (!X.looking_at(NODE_STAT_END)) {
                    if (!maybe_only()) {
                        node.expr = X.parse_expression();
                    }
                    maybe_only();
                }
                X.skip(NODE_STAT_END);
                node.body = X.parse_until(X.end_body_predicate(/^endwith$/, true));
                return node;
            },
            compile: function(env, X, node) {
                var expr = node.expr ? X.compile(env, node.expr) : "";
                var name = X.gensym();
                var code = "function " + name + "(" + name + "){";
                if (expr) {
                    code += "with(" + name + ")";
                }
                code += "return(";
                if (node.only) {
                    code += X.outside_main(function(){
                        return X.compile(X.root_env.extend(), node.body);
                    });
                } else {
                    code += X.compile(env.extend(), node.body);
                }
                code += ")}";
                if (node.only) {
                    X.add_function(name, code);
                    code = name;
                }
                return "(" + code + "(" + expr + "))";
            }
        },

        "macro": {
            parse: function(X) {
                var node = {};
                node.name = X.skip(NODE_SYMBOL);
                node.vars = X.delimited("(", ")", ",", function(){
                    var name = X.skip(NODE_SYMBOL), defval;
                    if (X.looking_at(NODE_OPERATOR, "=")) {
                        X.next();
                        defval = X.parse_expression();
                    }
                    return { name: name, defval: defval };
                });
                X.skip(NODE_STAT_END);
                node.body = X.parse_until(X.end_body_predicate(/^endmacro$/));
                X.skip(NODE_SYMBOL);
                if (X.looking_at(NODE_SYMBOL)) {
                    if (X.next().value != node.name.value) {
                        X.croak("Wrong name in endmacro");
                    }
                }
                X.skip(NODE_STAT_END);
                return node;
            },
            compile: function(env, X, node) {
                var args = node.vars.map(function(arg){ return arg.name.value });
                var code = "function " + X.output_name(node.name.value)
                    + "(" + args.map(X.output_name).join(",") + "){";
                env = X.root_env.extend();
                node.vars.forEach(function(arg){
                    if (arg.defval) {
                        code += "if (" + X.output_name(arg.name.value) + " === void 0)"
                            + X.output_name(arg.name.value) + "=" + X.compile(env, arg.defval) + ";";
                    }
                    env = env.extend(arg.name.value);
                });
                env = env.extend();
                var used_vars;
                var body = X.outside_main(function(params){
                    // compiler will collect accessed names that are
                    // not defined with {%set%} into this array.  we'll use
                    // that to avoid declaring varargs if it's not necessary.
                    used_vars = params;
                    return X.compile(env, node.body);
                });
                code += X.output_vars(env.own());
                if (used_vars.indexOf("varargs") >= 0) {
                    code += "var varargs = [].slice.call(arguments, " + args.length + ");";
                }
                code += "return " + body + "}";
                X.add_export(node.name.value, code);
            }
        },

        "import": {
            parse: function(X) {
                var node = { template: X.parse_expression() };
                X.skip(NODE_SYMBOL, "as");
                node.name = X.skip(NODE_SYMBOL);
                X.skip(NODE_STAT_END);
                return node;
            },
            compile: function(env, X, node) {
                env.def(node.name.value);
                if (node.template.type == NODE_SYMBOL && node.template.value == "_self") {
                    return "(" + X.output_name(node.name.value) + "=_self,'')";
                } else {
                    X.add_dependency(node.template);
                    return "(" + X.output_name(node.name.value)
                        + "=$TR.get(" + X.compile(env, node.template) + "),'')";
                }
            }
        },

        "from": {
            parse: function(X) {
                var node = { template: X.parse_expression(), defs: [] };
                X.skip(NODE_SYMBOL, "import");
                do {
                    if (node.defs.length) X.next(); // skip comma
                    var theirs = X.skip(NODE_SYMBOL), ours = theirs;
                    if (X.looking_at(NODE_SYMBOL, "as")) {
                        X.next();
                        ours = X.skip(NODE_SYMBOL);
                    }
                    node.defs.push({ theirs: theirs, ours: ours });
                } while (X.looking_at(NODE_PUNC, ","));
                X.skip(NODE_STAT_END);
                return node;
            },
            compile: function(env, X, node) {
                var tmpl;
                if (node.template.type == NODE_SYMBOL && node.template.value == "_self") {
                    tmpl = "_self";
                } else {
                    X.add_dependency(node.template);
                    env.def(tmpl = X.gensym());
                }
                var defs = node.defs.map(function(def){
                    env.def(def.ours.value);
                    return X.output_name(def.ours.value) + "=" + tmpl
                        + "[" + JSON.stringify(X.output_name(def.theirs.value)) + "]";
                });
                var code = "(";
                if (tmpl != "_self") {
                    code += tmpl + "=$TR.get(" + X.compile(env, node.template) + "),";
                }
                return code + defs.join(",") + ",'')";
            }
        },

        "spaceless": {
            parse: function(X) {
                X.skip(NODE_STAT_END);
                // XXX: we could optimize big by dropping spaces at
                // parse-time or compile-time, but for now this'll do.
                return {
                    body: X.parse_until(X.end_body_predicate(/^endspaceless$/, true))
                };
            },
            compile: function(env, X, node) {
                return "$SPACELESS(" + X.compile(env, node.body) + ")";
            }
        },

        "include": {
            parse: function(X) {
                var node = { template: X.parse_expression() };
                if (X.looking_at(NODE_SYMBOL, "ignore")) {
                    X.next();
                    X.skip(NODE_SYMBOL, "missing");
                    node.optional = true;
                }
                if (X.looking_at(NODE_SYMBOL, "with")) {
                    X.next();
                    node.vars = X.parse_expression();
                }
                if (X.looking_at(NODE_SYMBOL, "only")) {
                    X.next();
                    node.only = true;
                }
                X.skip(NODE_STAT_END);
                return node;
            },
            compile: function(env, X, node) {
                X.add_dependency(node.template);
                var args = [
                    X.compile(env, node.template)
                ];
                var ctx = X.make_context(env);
                if (node.vars) {
                    if (node.only) {
                        args.push(X.compile(env, node.vars));
                    } else {
                        args.push("$MERGE({},$DATA," +
                                  (ctx ? ctx + "," : "") +
                                  X.compile(env, node.vars) + ")");
                    }
                } else if (!node.only) {
                    args.push("$MERGE({},$DATA" + (ctx ? "," + ctx : "") + ")");
                }
                if (node.optional) {
                    args.push("true");
                }
                return "$INCLUDE(" + args.join(",") + ")";
            }
        }
    };

    var COMPILER_HOOKS = {};

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

    var instance = RUNTIME.merge(Object.create(NODES), {
        parse   : parse,
        Lexer   : Lexer,
        init    : init,
        compile : compile,
        deftag  : deftag,
        defhook : defhook
    });
    return instance;

    function deftag(name, impl) {
        if (typeof name == "object") {
            RUNTIME.merge(CORE_TAGS, name);
        } else {
            CORE_TAGS[name] = impl;
        }
    }

    function defhook(node, handler) {
        if (typeof node == "object") {
            RUNTIME.merge(COMPILER_HOOKS, node);
        } else {
            COMPILER_HOOKS[node] = handler;
        }
    }

    function with_tags(tags, func) {
        var save = CORE_TAGS;
        try {
            CORE_TAGS = RUNTIME.merge(Object.create(CORE_TAGS), tags);
            return func();
        } finally {
            CORE_TAGS = save;
        }
    }

    function init() {
        var rx = "^(?:" + ALL_OPERATORS.sort(function(a, b){
            return b.length - a.length;
        }).map(quote_regexp).join("|") + ")";
        RX_OPERATOR = new RegExp(rx);
        return instance;
    }

    function quote_regexp(string) {
        var rx = string.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
            .replace(/\s+/g, "\\s+");
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
                precedence[b[j]] = 10 * (i + 1);
            }
        }
        return precedence;
    }

    function is_constant(node) {
        switch (node.type) {
          case NODE_STR:
          case NODE_NUMBER:
          case NODE_BOOLEAN:
          case NODE_NULL:
            return true;
        }
    }

    /* -----[ Das Parser ]----- */

    function parse(input) {
        input = Lexer(input);

        var context = RUNTIME.merge(Object.create(NODES), {
            croak              : croak,
            delimited          : delimited,
            end_body_predicate : end_body_predicate,
            input              : input,
            eof                : input.eof,
            is                 : is,
            looking_at         : looking_at,
            next               : next,
            parse_expression   : parse_expression,
            parse_atom         : parse_atom,
            parse_next         : parse_next,
            parse_until        : parse_until,
            peek               : peek,
            skip               : skip,
            with_tags          : with_tags,
            is_constant        : is_constant
        });

        return parse_until(function(){ return false });

        function peek() {
            return input.peek();
        }

        function next() {
            return input.next();
        }

        function parse_next() {
            var tok = peek();
            if (tok.type == NODE_TEXT) {
                // seems in order to treat plain text as just string
                // nodes, simplifies some optimization cases in the
                // compiler
                tok.type = NODE_STR;
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

        function parse_expression(prec) {
            var exp = maybe_binary(parse_atom(), prec || 0);
            return prec ? exp : maybe_ternary(exp);
        }

        function parse_atom() {
            var atom, tok, seq;
            if (looking_at(NODE_PUNC, "(")) {
                next();
                seq = [];
                while (true) {
                    seq.push(parse_expression());
                    if (looking_at(NODE_PUNC, ",")) next();
                    else break;
                }
                skip(NODE_PUNC, ")");
                atom = maybe_lambda(seq.length > 1 ? { type: NODE_SEQ, body: seq } : seq[0]);
            }
            else if (looking_at(NODE_PUNC, "{")) {
                atom = parse_hash();
            }
            else if (looking_at(NODE_PUNC, "[")) {
                atom = parse_array();
            }
            else if (looking_at(NODE_SYMBOL)) {
                atom = maybe_lambda(parse_symbol());
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
                    expr: tok.value == "not" ? parse_expression(PRECEDENCE_NOT) : parse_atom()
                };
            }
            else {
                croak("Unexpected token in expression");
            }
            while (true) {
                var orig = atom;
                atom = maybe_filter(maybe_call(maybe_index(atom)));
                if (atom == orig) return atom;
            }
        }

        function maybe_lambda(expr) {
            if (!looking_at(NODE_OPERATOR, "=>")) return expr;
            next();
            // check validity, expr should be either a symbol or a
            // list of symbols (argument names).  I'm not sure default
            // values are supported?
            var args;
            if (expr.type == NODE_SEQ) {
                expr.body.forEach(assert_symbol);
                args = expr.body;
            } else {
                assert_symbol(expr);
                args = [ expr ];
            }
            return {
                type: NODE_LAMBDA,
                args: args,
                body: parse_expression()
            };
        }

        function assert_symbol(node) {
            if (node.type != NODE_SYMBOL)
                croak("Expected argument name at " + dump(node));
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
            if (tok.value == "null") {
                return { type: NODE_NULL, value: null };
            }
            return tok;
        }

        function parse_interpolated_string() {
            skip(NODE_INT_STR_BEG);
            var body = [];
            while (!looking_at(NODE_INT_STR_END)) {
                if (looking_at(NODE_INT_STR)) {
                    var tok = input.next();
                    if (tok.value.length) {
                        tok.type = NODE_STR;
                        body.push(tok);
                    }
                } else {
                    body.push(parse_expression());
                }
            }
            tok = skip(NODE_INT_STR_END);
            if (tok.value.length || !body.length) {
                tok.type = NODE_STR;
                body.push(tok);
            }
            if (body.length == 1 && body[0].type == NODE_STR) {
                return body[0];
            }
            return (function strcat(body){
                if (body.length < 2) {
                    return body[0];
                }
                return {
                    type     : NODE_BINARY,
                    operator : "~",
                    right    : body.pop(),
                    left     : strcat(body)
                };
            }(body));
        }

        function parse_array() {
            return {
                type: NODE_ARRAY,
                body: delimited("[", "]", ",", parse_expression)
            };
        }

        function parse_hash() {
            return {
                type: NODE_HASH,
                body: delimited("{", "}", ",", parse_hash_entry)
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

        function parse_test_op() {
            var tok = next();
            var node = {
                type: NODE_TEST_OP,
                operator: tok.value
            };
            switch (tok.value) {
              case "constant":
                throw new Error("TweegJS does not support `constant` test operator");
              case "divisible":
                skip(NODE_SYMBOL, "by");
                node.expr = parse_atom();
                break;
              case "same":
                skip(NODE_SYMBOL, "as");
                node.expr = parse_atom();
                break;
            }
            return node;
        }

        /* -----[ the "maybe" functions ]----- */

        function maybe_binary(left, my_prec) {
            var tok = looking_at(NODE_OPERATOR);
            var his_prec = tok && BINARY_OPERATORS[tok.value];
            if (his_prec > my_prec) {
                next();
                if (tok.value == "is" || tok.value == "is not") {
                    // XXX: handle Twig tests: constant, defined,
                    // divisible by(..), empty, even, iterable,
                    // null, odd, same as(..)
                    var right = peek();
                    if (right.type == NODE_SYMBOL && RX_TEST_OPS.test(right.value)) {
                        return maybe_binary({
                            type     : NODE_BINARY,
                            operator : tok.value,
                            left     : left,
                            right    : parse_test_op()
                        }, my_prec);
                    }
                }
                return maybe_binary({
                    type     : NODE_BINARY,
                    operator : tok.value,
                    left     : left,
                    right    : maybe_binary(parse_atom(), his_prec)
                }, my_prec);
            }
            return left;
        }

        function maybe_ternary(expr) {
            if (looking_at(NODE_OPERATOR, "?")) {
                next();
                expr = {
                    type: NODE_COND,
                    cond: expr,
                    then: parse_expression(),
                    else: looking_at(NODE_PUNC, ":") ? (next(), parse_expression()) : EMPTY_STRING
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
            var prop, start, length;
            if (looking_at(NODE_PUNC, "[")) {
                next();
                if (looking_at(NODE_PUNC, ":")) {
                    // handle slice syntax with no start: [:2, :-3] etc.
                    next();
                    length = looking_at(NODE_PUNC, "]") ? { type: NODE_NULL } : parse_expression();
                    skip(NODE_PUNC, "]");
                    return {
                        type: NODE_SLICE,
                        expr: expr,
                        start: { type: NODE_NULL },
                        length: length
                    };
                }
                prop = parse_expression();
                if (looking_at(NODE_PUNC, ":")) {
                    // handle slice syntax with start: [1:2, 0:-3] etc.
                    start = prop;
                    next();
                    length = looking_at(NODE_PUNC, "]") ? { type: NODE_NULL } : parse_expression();
                    skip(NODE_PUNC, "]");
                    return {
                        type: NODE_SLICE,
                        expr: expr,
                        start: start,
                        length: length
                    };
                }
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
                if (finished()) break;
                if (first) first = false; else skip(NODE_PUNC, separator);
                if (finished()) break;
                a.push(parser());
            }
            skip(NODE_PUNC, stop);
            return a;

            function finished() {
                if (stop == "}" && looking_at(NODE_EXPR_END)) {
                    input.fixex(); // handle "}}" in minified JSON
                    return true;
                }
                return looking_at(NODE_PUNC, stop);
            }
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

    function compile(node, options, env) {
        if (!env) env = new Environment();
        var context = RUNTIME.merge(Object.create(NODES), {
            root_env         : env,
            compile          : compile,
            compile_bool     : compile_bool,
            compile_num      : compile_num,
            compile_cond     : compile_cond,
            output_vars      : output_vars,
            output_name      : output_name,
            add_function     : add_function,
            add_export       : add_export,
            outside_main     : outside_main,
            with_escaping    : with_escaping,
            make_context     : make_context,
            add_dependency   : add_dependency,
            is_constant      : is_constant,
            gensym           : gensym,
            with_tags        : with_tags
        });
        var autoescape = option("autoescape", "html");
        var dependencies;
        var parameters;
        var functions;
        var exports;
        var output_code = "var _self = $TR.t({ $main: " + compile_main() + "});";
        functions.forEach(function(f){
            output_code += f.code + ";";
        });
        output_code += exports + "return _self";
        return {
            code: "function(){" + output_code + "}",
            dependencies: dependencies
        };

        function option(name, def, val) {
            if (!options) return def;
            val = options[name];
            return val === undefined ? def : val;
        }

        function add_export(name, code) {
            exports += "_self[" + JSON.stringify(name) + "]=" + code + ";";
        }

        function add_dependency(node) {
            if (node.type == NODE_STR) {
                dependencies.push(node.value);
            } else if (node.type == NODE_ARRAY) {
                node.body.forEach(add_dependency);
            } else {
                // let's mark complex deps by just adding the AST node
                dependencies.push(node);
            }
        }

        function outside_main(f) {
            var save = parameters;
            parameters = [];
            try {
                return f(parameters);
            } finally {
                parameters = save;
            }
        }

        function compile_main() {
            parameters = [];
            dependencies = [];
            functions = [];
            exports = "";
            env = env.extend();
            var body = compile(env, node);
            var main = "function($DATA){";
            main += output_vars(env.own());
            var args = parameters.reduce(function(a, name){
                if (!/^(?:_self|_context)$/.test(name)) {
                    a.push(output_name(name) + "=$DATA[" + JSON.stringify(name) + "]");
                }
                return a;
            }, []);
            if (args.length) {
                main += "var " + args.join(",") + ";";
            }
            main += "return " + body + "}";
            return main;
        }

        function make_context(env) {
            var ctx = [];
            var has = false;
            for (var i in env.vars) {
                // we explicitly want to dig prototype components too,
                // but exclude internal stuff, which will start with $
                if (!/^\$/.test(i)) {
                    ctx.push(JSON.stringify(i) + ":" + output_name(i));
                    has = true;
                }
            }
            return has ? "{" + ctx.join(",") + "}" : null;
        }

        function gensym() {
            return "$SYM" + (++GENSYM);
        }

        function add_function(name, code) {
            functions.push({ name: name, code: code });
        }

        function compile(env, node) {
            // var loc = node.loc ? ("/*" + node.loc.line + ":" + node.loc.col + "*/") : "";
            var loc = "";
            return parens(loc + _compile(env, node));
        }

        function _compile(env, node) {
            var handler = COMPILER_HOOKS[node.type];
            if (handler) {
                var code = handler(env, context, node);
                if (code != null) {
                    if (typeof code == "string") {
                        return code; // JS was provided
                    }
                    node = code; // AST was provided, compile that next
                }
            }
            if (is_constant(node)) {
                return JSON.stringify(node.value);
            }
            switch (node.type) {
              case NODE_PROG        : return compile_prog(env, node);
              case NODE_BINARY      : return compile_binary(env, node);
              case NODE_COND        : return compile_cond(env, node);
              case NODE_UNARY       : return compile_unary(env, node);
              case NODE_FILTER      : return compile_filter(env, node);
              case NODE_INDEX       : return compile_index(env, node);
              case NODE_ARRAY       : return compile_array(env, node);
              case NODE_HASH        : return compile_hash(env, node);
              case NODE_SYMBOL      : return compile_sym(env, node);
              case NODE_STAT        : return compile_stat(env, node);
              case NODE_CALL        : return compile_call(env, node);
              case NODE_ESCAPE      : return compile_escape(env, node);
              case NODE_SLICE       : return compile_slice(env, node);
              case NODE_VAR         : return compile_var(env, node);
              case NODE_LAMBDA      : return compile_lambda(env, node);
            }
            throw new Error("Cannot compile node " + JSON.stringify(node));
        }

        function compile_lambda(env, node) {
            var args = node.args.map(function(sym){ return sym.value });
            var body = "function(" + args.map(output_name).join(",") + "){";
            env = env.extend.apply(env, args);
            env = env.extend(); // to avoid defining args as local vars by env.own() below
            var code = compile(env, node.body);
            body += output_vars(env.own());
            body += "return(" + code + ");}";
            return body;
        }

        function compile_var(env, node) {
            return node.name;   // internal variables (gensym)
        }

        function parens(str) {
            return "(" + str + ")";
        }

        function compile_prog(env, node) {
            var a_body = [];
            function add(item) {
                if (is_constant(item) || item.type == NODE_STAT) {
                    a_body.push(item);
                } else {
                    a_body.push({ type: NODE_ESCAPE, expr: item });
                }
            }
            node.body.forEach(function do_item(item){
                if (item.type == NODE_PROG) {
                    item.body.forEach(do_item);
                } else {
                    add(item);
                }
            });
            var b_body = [];
            a_body.forEach(function(item){
                var code = compile(env, item);
                if (code != "('')" && code != '("")' && code != "(undefined)" && code != "(null)") {
                    b_body.push(code);
                }
            });
            return "$OUT([" + b_body.join(",") + "])";
        }

        function compile_slice(env, node) {
            return "$SLICE(" + compile(env, node.expr) + "," +
                compile(env, node.start) + "," + compile(env, node.length) + ")";
        }

        function compile_escape(env, node) {
            if (autoescape) {
                if (node.expr.type == NODE_FILTER && node.expr.name.value == "raw") {
                    return compile(env, node.expr.expr);
                }
            }
            if (autoescape) {
                return "$ESC_" + autoescape + "(" + compile(env, node.expr) + ")";
            } else {
                return compile(env, node.expr);
            }
        }

        function with_escaping(esc, func) {
            var save = autoescape;
            autoescape = esc;
            try {
                return func();
            } finally {
                autoescape = save;
            }
        }

        function compile_call(env, node) {
            var args = "(" + node.args.map(function(item){
                return compile(env, item);
            }).join(",") + ")";
            if (node.func.type == NODE_SYMBOL) {
                if (env.lookup(node.func.value)) {
                    return compile(env, node.func) + args;
                }
                return "$FUNC[" + JSON.stringify(node.func.value) + "]" + args;
            }
            return compile(env, node.func) + args;
        }

        function compile_index(env, node) {
            return "$INDEX(" + compile(env, node.expr) + "," + compile(env, node.prop) + ")";
            //return compile(env, node.expr) + "[" + compile(env, node.prop) + "]";
        }

        function compile_filter(env, node) {
            var code = "$FILTER[" + JSON.stringify(node.name.value)
                + "](" + compile(env, node.expr);
            if (node.args.length) {
                code += "," + node.args.map(function(item){
                    return compile(env, item);
                }).join(",");
            }
            return code + ")";
        }

        function is_boolean(node) {
            return node.type == NODE_BOOLEAN
                || (node.type == NODE_UNARY && node.operator == "not")
                || (node.type == NODE_BINARY && /^(?:and|or|==|!=|<|>|<=|>=|in|not in|matches|starts with|ends with|is|is not)$/.test(node.operator))
                || (node.type == NODE_COND && is_boolean(node.left) && is_boolean(node.right));
        }

        function compile_bool(env, node, sym) {
            if (sym) {
                return is_boolean(node)
                    ? parens(sym + "=" + compile(env, node))
                    : "$BOOL(" + sym + "=" + compile(env, node) + ")";
            } else {
                return is_boolean(node)
                    ? compile(env, node)
                    : "$BOOL(" + compile(env, node) + ")";
            }
        }

        function is_string(node) {
            return node.type == NODE_STR || node.type == NODE_PROG || node.type == NODE_STAT
                || (node.type == NODE_BINARY && /^[~]$/.test(node.operator))
                || (node.type == NODE_COND && is_string(node.then) && is_string(node.else));
        }

        function compile_str(env, node) {
            return is_string(node)
                ? compile(env, node)
                : "$STR(" + compile(env, node) + ")";
        }

        function is_number(node) {
            return node.type == NODE_NUMBER
                || (node.type == NODE_UNARY && /^[-+]$/.test(node.operator))
                || (node.type == NODE_BINARY && /^[-+*/%]/.test(node.operator))
                || (node.type == NODE_COND && is_number(node.then) && is_number(node.else));
        }

        function compile_num(env, node) {
            return is_number(node)
                ? compile(env, node)
                : "$NUMBER(" + compile(env, node) + ")";
        }

        function compile_array(env, node) {
            return "[" + node.body.map(function(item){
                return compile(env, item);
            }).join(",") + "]";
        }

        function compile_hash(env, node) {
            var constant_keys = true;
            for (var i = 0; i < node.body.length; ++i) {
                var item = node.body[i];
                if (!is_constant(item.key)) {
                    constant_keys = false;
                    break;
                }
            }
            if (constant_keys) {
                return "{" + node.body.map(function(item){
                    return JSON.stringify(item.key.value) + ":" + compile(env, item.value);
                }).join(",") + "}";
            }
            return "$HASH([" + node.body.map(function(item){
                return compile(env, item.key) + "," + compile(env, item.value);
            }).join(",") + "])";
        }

        function compile_sym(env, node) {
            var name = node.value;
            var not_defined = !env.lookup(name);
            if (not_defined && parameters.indexOf(name) < 0) {
                parameters.push(name);
            }
            if (not_defined && RUNTIME.is_global(name)) {
                return "$GLOBAL(" + JSON.stringify(name) + ")";
            }
            return output_name(name);
        }

        function output_name(name) {
            return name;
        }

        function compile_binary(env, node) {
            var sym, op = node.operator, left, right;
            switch (op) {
              case "??":
                env.def(sym = gensym());
                return "(" + sym + "=" + compile(env, node.left) + ")!=null?" + sym + ":" + compile(env, node.right);

              case "?:":
                env.def(sym = gensym());
                return compile_bool(env, node.left, sym) + "?" + sym + ":" + compile(env, node.right);

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

              case "<=>":
                env.def(left = gensym());
                env.def(right = gensym());
                return "((" + left + "=" + compile(env, node.left) + "),"
                    +  "(" + right + "=" + compile(env, node.right) + "),"
                    +  left + "<" + right + "? -1 :" + left + ">" + right + "? 1 : 0)";

              case "+": case "-": case "*": case "/": case "%":
                return compile_num(env, node.left) + op + compile_num(env, node.right);

              case "//":
                return "Math.floor(" + compile_num(env, node.left) + "/" + compile_num(env, node.right) + ")";

              case "**":
                return "Math.pow(" + compile_num(env, node.left) + "," + compile_num(env, node.right) + ")";

              case "~":
                return compile_str(env, node.left) + "+" + compile_str(env, node.right);

              case "not in":
                return "!" + compile_operator(env, "in", node);

              case "is":
                return compile_is(env, node);

              case "is not":
                return "!" + compile_is(env, node);

              case "matches": case "starts with": case "ends with": case "..": case "in":
                return compile_operator(env, op, node);
            }

            throw new Error("Unknown operator " + op);
        }

        function compile_is(env, node) {
            var left = compile(env, node.left);
            if (node.right.type == NODE_TEST_OP) {
                switch (node.right.operator) {
                  case "defined":
                    return parens(left + "!=null");
                  case "divisible":
                    return parens(left + "%" + compile(env, node.right.expr) + "==0");
                  case "empty":
                    return "$EMPTY(" + left + ")";
                  case "even":
                    return parens(left + "%2==0");
                  case "odd":
                    return parens(left + "%2!=0");
                  case "iterable":
                    return "$ITERABLE(" + left + ")";
                  case "null":
                    return parens(left + "==null");
                  case "same":
                    return parens(left + "===" + compile(env, node.right.expr));
                }
            } else {
                return parens(left + "===" + compile(env, node.right));
            }
        }

        function compile_unary(env, node) {
            return node.operator == "not"
                ? "!" + compile_bool(env, node.expr)
                : node.operator + compile_num(env, node.expr);
        }

        function compile_cond(env, node) {
            return compile_bool(env, node.cond)
                + "?" + compile(env, node.then)
                + ":" + compile(env, node.else);
        }

        function compile_operator(env, op, node) {
            return "$OP[" + JSON.stringify(op) + "]("
                + compile(env, node.left) + "," + compile(env, node.right) + ")";
        }

        function compile_stat(env, node) {
            var impl = CORE_TAGS[node.tag];
            if (!impl || !impl.compile) {
                throw new Error("Compiler not implemented for `" + node.tag + "`");
            }
            var code = impl.compile(env, context, node);
            if (code != null && typeof code != "string") {
                // AST was provided
                code = compile(env, code);
            }
            return code || "''";
        }

        function output_vars(vars) {
            if (vars.length) {
                return "var " + vars.map(function(name){
                    return output_name(name);
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
            fixex : fixex,
            skip  : input.skip,
            eof   : eof,
            croak : croak
        };

        function next() {
            return peeked.length ? peeked.shift() : read_token();
        }

        function peek() {
            if (!peeked.length) {
                peeked.push(read_token());
            }
            return peeked[0];
        }

        function fixex() {
            // the lexer has seen "}}" and returned NODE_EXPR_END, but
            // the parser figured out we're actually closing two
            // brackets in some JSON-like object, and calls this
            // function for the lexer has to fix the mess.

            // since it's called after peeking, the NODE_EXPR_END
            // token is in `peeked`.  Ugly hacks but I have no better
            // ideas.
            var tok = peeked.shift();
            tok = { loc: tok.loc, type: NODE_PUNC, value: "}" };

            // two of these are needed.  `loc` will be slightly wrong,
            // but good enough.
            peeked.unshift(tok);
            peeked.unshift(tok);

            // back into expression mode.
            push_state(LEX_EXPRESSION);
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

        function is_punc(ch) {
            return ".,:;(){}[]".indexOf(ch) >= 0;
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
            var m = input.skip(/^([^]*?)(-?\#\})/);
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
                return token(NODE_OPERATOR, m[0].replace(/\s+/, " "));
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
            if ((m = input.skip(/^[a-z_][a-z_0-9]*/i))) {
                // XXX: what are the allowed characters in identifiers?
                return token(NODE_SYMBOL, m[0]);
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
                    skip_comment();
                    return read_token();
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

TWEEG.wrap_code = function(code) {
    return "function $TWEEG($TR){\
var $BOOL = $TR.bool\
,$EMPTY = $TR.empty\
,$ESC = $TR.escape\
,$ESC_html = $TR.escape_html\
,$ESC_js = $TR.escape_js\
,$FILTER = $TR.filter\
,$FOR = $TR.for\
,$FUNC = $TR.func\
,$HASH = $TR.hash\
,$INCLUDE = $TR.include\
,$ITERABLE = $TR.iterable\
,$MERGE = $TR.merge\
,$NUMBER = $TR.number\
,$OP = $TR.operator\
,$OUT = $TR.out\
,$REGISTER = $TR.register\
,$SLICE = $TR.slice\
,$SPACELESS = $TR.spaceless\
,$STR = $TR.string\
,$INDEX = $TR.index\
,$GLOBAL = $TR.global\
;" + code + "}";
};
