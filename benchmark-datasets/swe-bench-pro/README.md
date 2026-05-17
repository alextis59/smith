# SWE-bench Pro Sample

This dataset contains 10 extracted tasks from the public `ScaleAI/SWE-bench_Pro` test split. The task prompts and evaluator run scripts are committed locally; repository workspaces are prepared at run time from the prebuilt Docker images listed in each task's `task.json`. Gold patches and test patches are intentionally not committed.

Run all sample tasks:

```sh
smith benchmark run swe-bench-pro --timeout-ms 900000
```

Run one task:

```sh
smith benchmark run swe-bench-pro/001-nodebb-nodebb-vnan --timeout-ms 900000
```
