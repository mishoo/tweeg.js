# TweegJS: a Twig -> JavaScript compiler

**This project is sponsored by [eMAG](http://www.emag.ro/) — the biggest online
retailer in Romania.**

[Twig](http://twig.sensiolabs.org/) is a template engine popular in the PHP
world.  I personally don't like it much, but it does the job.  We're kinda stuck
with it on the server, so in order to be able to reuse the same templates on the
client I implemented this tool, which is able to compile a Twig template to
JavaScript.  It's very much a work in progress, but we'll start using it soon
and we'll fix issues as they come up.

I emphasize the word *compile*: halfway through I found
[twig.js](https://github.com/twigjs/twig.js/), another project which claims to
do the same, but [see this issue](https://github.com/twigjs/twig.js/issues/80):
`twig.js` is only able to produce a parse tree, and requires the whole library
(which is kinda heavy) to be loaded on the client in order to render
(*interpret*) that AST.  This is different from our approach: we produce JS code
that executes the template.  Template compilation can and should be done at
build time, unless for some reason you need to generate templates dinamically.
You then load the compiled code with a `<script>` tag, and call the function to
get the result.  This code depends on a very small runtime and does not require
an interpreter to render the template.

Here is an example:

```twig
{%- macro link(url, text) -%}
  <a href="{{ url|e }}">{{ text|e }}</a>
{%- endmacro -%}

<h1>{{ hello }} {{ world }}!</h1>

<p>Check out {{ link("http://github.com/mishoo/tweegjs", "TweegJS") }}</p>
```

produces the following output:

```js
function $TWEEG(n) {
    function e(n, e) {
        return r([ '<a href="', o.e(n), '">', o.e(e), "</a>" ]);
    }
    var t = {}, r = n.out, o = n.filter;
    return t.link = e, t.$main = function(n) {
        var t = n.hello, o = n.world;
        return r([ "<h1>", t, " ", o, "!</h1>\n\n<p>Check out ",
                 e("http://github.com/mishoo/tweegjs", "TweegJS"),
                 "</p>\n" ]);
    }, t;
}
```

> Note that I [uglified](https://github.com/mishoo/UglifyJS2/) the code, but
> it's indented above, to make it easier to understand.  TweegJS does some
> optimizations to enable UglifyJS to do a better job at minifying it.  The
> generated code, after uglification, should be roughly the same size as the
> input template — perhaps a bit bigger, but not by much.

Compiling a template produces a single JS function.  Call this function once to
“instantiate” the template.  Note that calling this function will not
immediately execute the template, but it returns a JS object containing a
`$main` function, along with any macros defined in the file.  This should allow
implementing `import` at some point (but it's not done yet).

I haven't yet decide how this function will actually be used on the client, but
for the time being it can be done like this:

```html
<script src="path/to/tweeg/runtime.js"></script> <!-- load the runtime -->
<script>
  // this global will hold our templates
  window.TEMPLATES = {};
  // instantiate the runtime
  window.RUNTIME = TWEEG_RUNTIME();
  // provide any custom functions / filters you need, e.g.
  RUNTIME.filters.blah = function(str) {
    return "<blah>" + str + "</blah>";
  };
</script>
<script src="hello-world.twig.js"></script> <!-- this loads the code above -->
<script>
  // instantiate the template that we just loaded
  TEMPLATES.helloWorld = $TWEEG(RUNTIME);
</script>
```

Then when we need to render the template, we can do the following:

```js
div.innerHTML = TEMPLATES.helloWorld.$main({
    hello: "Hello",
    world: "World"
});
```
