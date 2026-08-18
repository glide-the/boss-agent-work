# 08 Runtime Differential Validation

Validation layers:

1. syntax and export snapshots;
2. function signature and object-shape snapshots;
3. CLI fixture differentials;
4. mock JSON-RPC/Native Host protocol differentials;
5. Browser Security order and error snapshots;
6. baseline/candidate dual execution;
7. import smoke, typecheck, Bun build and marketplace assembly;
8. real Chrome only after explicit authorization.

Embedding the baseline makes a differential trivially pass and is therefore not accepted as independent implementation evidence.
