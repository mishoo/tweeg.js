require("../tweeg.js");
require("../runtime.js");

// as seen before, initialize the runtime and the Tweeg object
var runtime = TWEEG_RUNTIME();
var tweeg = TWEEG(runtime);
tweeg.init();

// `deftag` is the main way to define a custom tag
tweeg.deftag({
    "switch": {

        // the parser receives a single argument `X` (because naming
        // things is hard) which contains parser utilities.
        parse: function(X) {
            var expr = X.parse_expression(); // parse the switch expression
            X.skip(X.NODE_STAT_END);         // skip the end token, `%}`

            // this utility defines a predicate suitable for
            // X.parse_until, see below.  If we pass a second `true`
            // argument it will skip the encountered tag symbol,
            // otherwise it leaves it in the token stream.
            var end = X.end_body_predicate(/^(?:case|default|endswitch)$/);

            // skip to the first tag that we recognize
            X.parse_until(end);

            var cases = [];     // collect the switch cases here
            var defau = null;   // the `default` section

            // X.eof() tells us if the token stream is over.  Use this
            // rather than `while(true)` to avoid infinite loops for
            // syntactically invalid input (e.g. unterminated tag)
            while (!X.eof()) {
                var sym = X.skip(X.NODE_SYMBOL);
                if (sym.value == "case") {
                    cases.push({
                        expr: X.parse_expression(),     // the case expression
                        body: (X.skip(X.NODE_STAT_END), // skip the end token
                               X.parse_until(end))      // fetch the case body
                    });
                }
                else if (sym.value == "default") {
                    X.skip(X.NODE_STAT_END);            // skip the end token
                    defau = X.parse_until(end);         // default only has body
                }
                else if (sym.value == "endswitch") {
                    break;      // we're done
                }
            }

            // finally, skip the end token and return our AST node
            X.skip(X.NODE_STAT_END);

            // there is no need to mark it as a “switch” node, Tweeg
            // internally takes care of this.
            return { expr: expr, cases: cases, defau: defau };
        },

        // The compiler will receive three arguments: an environment
        // `env`, an object with compiler utilities `X`, and the node
        // produced by our parser above.
        //
        // It must return a string of JS code that executes our node.
        // This must be a single JS expression (no statements
        // allowed!).  If you need to execute statements, you can
        // embed everything in an IIFE.
        compile: function(env, X, node) {
            // to keep things simple, we will compile our `switch`
            // node as a series of conditional expressions, using the
            // ternary operator.  Essentially, we will produce this:
            //
            // foo==1?"Got one":foo==2?"Got two":"Dunno what gives"

            // If we have multiple cases, we'll have to compare the
            // expression with a value for each case.  We must be
            // careful to not compile the expression multiple times,
            // because then it will *run* multiple times.  Therefore
            // we invent a variable name to keep the value of the
            // expression (it's guaranteed not to clash with template
            // variables).  Welcome to Lisp!
            var sym = X.gensym();
            env.def(sym); // Tweeg will take care to output a `var` for it

            // prelude: store the switch expression in this variable
            var code = sym + "=" + X.compile(env, node.expr) + ",";

            // since Tweeg already knows how to compile ternary nodes,
            // we can cheat by generating such a node for our switch.
            // That's easier than producing JS as a string.  Here's a
            // piece of recursive magic.
            var body = (function loop(i){
                if (i < node.cases.length) {
                    // if we still have at least one case, return a
                    // ternary node (NODE_COND stands for conditional)
                    return {
                        type: X.NODE_COND,
                        cond: {
                            type: X.NODE_BINARY,
                            operator: "==",
                            left: { type: X.NODE_VAR, name: sym },
                            right: node.cases[i].expr
                        },
                        then: node.cases[i].body,
                        else: loop(i + 1) // loop for the next cases
                    };
                } else {
                    // we're done, either return the default value or
                    // an empty string.
                    return node.defau || X.EMPTY_STRING;
                }
            })(0);

            // now compile the node that we just produced
            code += X.compile(env, body);

            // parenthesize the result, just in case
            return "(" + code + ")";
        }
    }
});

// test
var fs = require("fs");

var test = fs.readFileSync("switch.html.twig", "utf8");
var ast = tweeg.parse(test);
//console.log(JSON.stringify(ast, null, 2));
var result = tweeg.compile(ast);
console.log(result.code);
