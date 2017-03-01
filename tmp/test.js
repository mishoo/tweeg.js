var runtime = TWEEG_RUNTIME();
$TWEEG(runtime);

console.log(runtime.exec("tmp/macros.html.twig", { foo: "<BLERG>" }));
