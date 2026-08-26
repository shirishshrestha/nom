#!/bin/bash
set -e
psql -v ON_ERROR_STOP=1 -U nom -c "CREATE DATABASE nom_test;"
